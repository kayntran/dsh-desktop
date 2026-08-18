/**
 * Move a model's inline `<think>…</think>` prose out of the answer and into a
 * real reasoning block.
 *
 * The wire protocol reserves its own field for a chain of thought
 * (`reasoning_content` and friends), and pi-ai maps that field to the harness
 * `reasoning` block the web UI renders as the Think row. Several
 * OpenAI-compatible providers — MiniMax M3 is the one that brought this here —
 * do not use that field: they write the thinking into the ordinary content
 * stream wrapped in `<think>` tags. Nothing downstream can tell that apart from
 * the answer, so it lands on screen as the first paragraph of the reply.
 *
 * Two rules keep the rewrite from misfiring on models that behave:
 *
 *  1. Only a tag opening the response counts. A `<think>` further along is a
 *     model quoting the tag (this project's own conversations do it), and it
 *     stays exactly where it is. That also covers a lone CLOSING tag, which is
 *     what a provider leaves in the answer when it sends the thinking through
 *     its own field but lets the mark slip through.
 *  2. Only one chain of thought per response survives — whichever arrives
 *     first. A provider that sends the same thinking twice, once in its own
 *     field and once wrapped in tags, would otherwise produce two Think rows.
 *
 * A stream with no opening tag passes through with its content untouched.
 * @module
 */

import type { ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm'

/**
 * Tag spellings seen in the wild. MiniMax writes plain `<think>`, and its
 * namespaced `<mm:think>` shows up too — same meaning, different spelling, and a
 * rewriter that knows only one leaves the other on screen.
 */
const OPEN_TAGS = ['<think>', '<mm:think>'] as const
const CLOSE_TAGS = ['</think>', '</mm:think>'] as const

/** Where the splitter stands inside one source text block. */
type Mode = 'undecided' | 'thinking' | 'text'

/** An output block currently receiving content. */
interface OpenBlock {
  index: number
  type: 'reasoning' | 'text'
  /** Everything emitted so far, so `block-end` can carry the assembled block. */
  text: string
}

/** One source text block, mid-split. */
interface TextState {
  mode: Mode
  /** Characters held back because a tag may straddle two deltas. */
  buffer: string
  /** Drop the blank lines that sit between `</think>` and the answer. */
  stripLeading: boolean
  open: OpenBlock | undefined
}

/**
 * Length of the longest suffix of `text` that could still grow into a tag.
 * @param text - the buffered characters.
 * @param tags - the tags being watched for.
 * @returns how many trailing characters must be held back.
 */
function danglingPrefix(text: string, tags: readonly string[]): number {
  let held = 0
  for (const tag of tags) {
    const max = Math.min(text.length, tag.length - 1)
    for (let length = max; length > held; length--) {
      if (text.endsWith(tag.slice(0, length))) held = length
    }
  }
  return held
}

/** The tag this text opens with, if any. */
function leadingTag(text: string, tags: readonly string[]): string | undefined {
  return tags.find(tag => text.startsWith(tag))
}

/** Whether this text could still grow into one of the tags. */
function mightBecomeTag(text: string, tags: readonly string[]): boolean {
  return tags.some(tag => tag.startsWith(text))
}

/** Earliest position of any closing tag, with the tag found. */
function findClose(text: string): { at: number, tag: string } | undefined {
  let best: { at: number, tag: string } | undefined
  for (const tag of CLOSE_TAGS) {
    const at = text.indexOf(tag)
    if (at >= 0 && (best === undefined || at < best.at)) best = { at, tag }
  }
  return best
}

/**
 * Rewrites one model response stream, chunk by chunk.
 *
 * Output block indexes are freshly numbered rather than reused: splitting one
 * source block into two needs an index the source never claimed, and renumbering
 * everything is the only way to be sure the new one collides with nothing. The
 * assembler orders blocks by the order they appear, not by index, so the reply
 * keeps its shape.
 */
export class ThinkTagRewriter {
  private nextIndex = 0
  /** Source index → output index, for blocks passed through unchanged. */
  private passThrough = new Map<number, number>()
  private texts = new Map<number, TextState>()
  /** Provider reasoning blocks dropped as duplicates of tagged thinking. */
  private dropped = new Set<number>()
  private reasoningFromTags = false
  private reasoningFromProvider = false
  /** True once a tag was consumed or a duplicate dropped. */
  private changed = false

  /**
   * Feed one chunk in.
   * @param chunk - the next chunk from the adapter.
   * @returns the chunks to hand downstream, possibly none, possibly several.
   */
  push(chunk: StreamChunk): StreamChunk[] {
    const out: StreamChunk[] = []
    switch (chunk.type) {
      case 'block-start': {
        if (chunk.blockType === 'text') {
          // Opened lazily: until the first delta arrives there is no way to know
          // whether this block starts with a tag, and the reasoning half needs
          // its own block opened before any text goes out.
          this.textState(chunk.index)
          break
        }
        if (chunk.blockType === 'reasoning') {
          if (this.reasoningFromTags) {
            this.dropped.add(chunk.index)
            this.changed = true
            break
          }
          this.reasoningFromProvider = true
        }
        out.push({ ...chunk, index: this.mapped(chunk.index) })
        break
      }
      case 'text-delta':
        this.feed(this.textState(chunk.index), chunk.text, false, out)
        break
      case 'reasoning-delta':
        if (this.dropped.has(chunk.index)) break
        this.reasoningFromProvider = true
        out.push({ ...chunk, index: this.mapped(chunk.index) })
        break
      case 'tool-call-delta':
        out.push({ ...chunk, index: this.mapped(chunk.index) })
        break
      case 'block-end': {
        const state = this.texts.get(chunk.index)
        if (state !== undefined) {
          this.texts.delete(chunk.index)
          this.feed(state, '', true, out)
          this.close(state, out)
          break
        }
        if (this.dropped.has(chunk.index)) break
        out.push({ ...chunk, index: this.mapped(chunk.index) })
        break
      }
      case 'usage':
        out.push(chunk)
        break
      case 'finish': {
        // An adapter that stops without closing its blocks — an abort, an error
        // mid-answer — still leaves a well-formed stream behind us.
        for (const state of [...this.texts.values()]) {
          this.feed(state, '', true, out)
          this.close(state, out)
        }
        this.texts.clear()
        out.push(this.changed ? this.withoutReplayState(chunk) : chunk)
        break
      }
    }
    return out
  }

  /** Output index for a block passed through unchanged. */
  private mapped(source: number): number {
    let index = this.passThrough.get(source)
    if (index === undefined) {
      index = this.nextIndex++
      this.passThrough.set(source, index)
    }
    return index
  }

  /** Splitter state for a text block, tolerating a delta with no `block-start`. */
  private textState(index: number): TextState {
    let state = this.texts.get(index)
    if (state === undefined) {
      state = { mode: 'undecided', buffer: '', stripLeading: false, open: undefined }
      this.texts.set(index, state)
    }
    return state
  }

  /**
   * Run the splitter over everything buffered.
   * @param state - the source block's splitter state.
   * @param delta - new characters, empty when only flushing.
   * @param end - the source block is over: decide on what is left rather than waiting.
   * @param out - chunks to hand downstream, appended in place.
   */
  private feed(state: TextState, delta: string, end: boolean, out: StreamChunk[]): void {
    state.buffer += delta
    for (;;) {
      if (state.mode === 'undecided') {
        const trimmed = state.buffer.replace(/^\s+/, '')
        if (trimmed.length === 0) {
          if (!end) return
          state.mode = 'text'
          continue
        }
        const opening = leadingTag(trimmed, OPEN_TAGS)
        if (opening !== undefined) {
          state.mode = 'thinking'
          state.buffer = trimmed.slice(opening.length)
          this.changed = true
          continue
        }
        // A CLOSING tag with nothing opened is what a provider leaves behind when
        // it sends the thinking itself through its own field and lets only the
        // tag slip into the answer. There is no thinking to move here — just a
        // stray mark, and it goes.
        const closing = leadingTag(trimmed, CLOSE_TAGS)
        if (closing !== undefined) {
          state.buffer = trimmed.slice(closing.length)
          state.mode = 'text'
          state.stripLeading = true
          this.changed = true
          continue
        }
        // `<thi` may still become `<think>` in the next delta.
        if (!end && (mightBecomeTag(trimmed, OPEN_TAGS) || mightBecomeTag(trimmed, CLOSE_TAGS))) return
        state.mode = 'text'
        continue
      }

      if (state.mode === 'thinking') {
        const close = findClose(state.buffer)
        if (close !== undefined) {
          this.emit(state, 'reasoning', state.buffer.slice(0, close.at), out)
          state.buffer = state.buffer.slice(close.at + close.tag.length)
          state.mode = 'text'
          state.stripLeading = true
          continue
        }
        const hold = end ? 0 : danglingPrefix(state.buffer, CLOSE_TAGS)
        this.emit(state, 'reasoning', state.buffer.slice(0, state.buffer.length - hold), out)
        state.buffer = state.buffer.slice(state.buffer.length - hold)
        return
      }

      if (state.stripLeading) {
        state.buffer = state.buffer.replace(/^\s+/, '')
        if (state.buffer.length === 0) return
        state.stripLeading = false
      }
      this.emit(state, 'text', state.buffer, out)
      state.buffer = ''
      return
    }
  }

  /** Append content to the output block of that type, opening one if needed. */
  private emit(state: TextState, type: 'reasoning' | 'text', text: string, out: StreamChunk[]): void {
    if (text.length === 0) return
    // The provider already sent this same thinking through its own field; a
    // second copy would render as a second Think row saying the same thing.
    if (type === 'reasoning' && this.reasoningFromProvider) return

    const open = state.open
    let block: OpenBlock
    if (open !== undefined && open.type === type) {
      block = open
    } else {
      this.close(state, out)
      block = { index: this.nextIndex++, type, text: '' }
      state.open = block
      out.push({ type: 'block-start', index: block.index, blockType: type })
    }

    block.text += text
    if (type === 'reasoning') {
      this.reasoningFromTags = true
      out.push({ type: 'reasoning-delta', index: block.index, text })
    } else {
      out.push({ type: 'text-delta', index: block.index, text })
    }
  }

  /** Close the open output block, carrying the block it assembled to. */
  private close(state: TextState, out: StreamChunk[]): void {
    const open = state.open
    if (open === undefined) return
    state.open = undefined
    const block: ContentBlock = open.type === 'reasoning'
      ? { type: 'reasoning', text: open.text }
      : { type: 'text', text: open.text }
    out.push({ type: 'block-end', index: open.index, block })
  }

  /**
   * Drop the adapter's replay state from a finish chunk.
   *
   * That state is the adapter's private record of the reply, and it is checked
   * entry by entry against the message before a later turn may reuse it. Once
   * the blocks are not the ones the adapter produced, keeping it makes the NEXT
   * request fail outright, so it goes.
   *
   * What that costs — the model no longer seeing its own thinking on later turns
   * — is a cost this plugin is not the right place to buy back. Realigning the
   * state by hand was tried and reverted: it meant writing into a structure
   * upstream declares private, which nothing in this project can check and which
   * would fail silently on a future engine. The relay plugin removes the need
   * entirely by making the provider send its thinking in the proper field, and
   * then this rewriter never fires at all.
   *
   * @param chunk - the terminal finish chunk.
   * @returns the same chunk without its replay state.
   */
  private withoutReplayState(chunk: Extract<StreamChunk, { type: 'finish' }>): StreamChunk {
    const { replayState: _replayState, ...rest } = chunk
    return rest
  }
}

/**
 * Wrap one model response stream.
 * @param source - chunks as the adapter produced them.
 * @returns the same stream with any opening `<think>…</think>` moved into a reasoning block.
 */
export async function* rewriteThinkTags(source: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
  const rewriter = new ThinkTagRewriter()
  for await (const chunk of source) {
    yield* rewriter.push(chunk)
  }
}
