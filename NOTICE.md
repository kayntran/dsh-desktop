# Notice / Ghi công

**Harness Desktop is not affiliated with, endorsed by, or sponsored by DeepSeek.**
It is an unofficial, community-built desktop shell.

**Harness Desktop không liên kết, không được DeepSeek bảo trợ hay chứng thực.**
Đây là lớp vỏ desktop do cộng đồng làm, không phải sản phẩm chính chủ.

## What this project is / Dự án này là gì

Harness Desktop is a thin Windows desktop shell around
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`),
the open-source agent harness published by DeepSeek AI under the MIT License.

This project **does not modify, fork, or vendor** any upstream source. It
depends on the published npm package `@deepseek-ai/dsh` and runs it unchanged.
Everything you see inside the app window — the chat interface, the agent, the
tools — is upstream's work. This project contributes only the desktop shell:
process lifecycle, window, tray, notifications, and the installer.

Harness Desktop là một lớp vỏ desktop mỏng bọc quanh DeepSeek Harness (`dsh`) —
agent harness mã nguồn mở do DeepSeek AI phát hành theo giấy phép MIT.

Dự án này **không sửa, không fork, không nhúng** bất kỳ mã nguồn nào của thượng
nguồn. Nó phụ thuộc vào gói npm `@deepseek-ai/dsh` và chạy gói đó nguyên trạng.
Mọi thứ bạn thấy bên trong cửa sổ app — giao diện chat, agent, các công cụ —
đều là công sức của thượng nguồn. Dự án này chỉ đóng góp phần vỏ desktop: vòng
đời tiến trình, cửa sổ, khay hệ thống, thông báo, và bộ cài.

## Upstream / Thượng nguồn

| | |
|---|---|
| Project | DeepSeek Harness (`dsh`) |
| Repository | https://github.com/deepseek-ai/deepseek-harness |
| License | MIT |
| Version bundled | see `engine/package.json` |

The upstream project discloses its own third-party dependencies in
[THIRD_PARTY_NOTICES.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/THIRD_PARTY_NOTICES.md).
Those dependencies ship inside this app and remain under their own licenses.

Thượng nguồn công bố các phụ thuộc bên thứ ba của họ trong
THIRD_PARTY_NOTICES.md. Những phụ thuộc đó nằm trong bản đóng gói của app này
và vẫn giữ giấy phép riêng của chúng.

## Trademarks / Nhãn hiệu

"DeepSeek" and "DeepSeek Harness" are names belonging to their respective
owners. They are used here only to state, factually, what this software is
built on. This project does not use those names as its own product name or
branding.

"DeepSeek" và "DeepSeek Harness" là tên thuộc về chủ sở hữu tương ứng. Chúng
được nhắc ở đây chỉ để nói đúng sự thật rằng phần mềm này dựa trên cái gì. Dự
án không dùng những tên đó làm tên sản phẩm hay thương hiệu của mình.

## This shell / Lớp vỏ này

The desktop shell code in `src/`, `scripts/`, and `resources/` is licensed
under the MIT License — see [LICENSE](LICENSE).

It also bundles two unmodified upstream binaries:

- [Electron](https://github.com/electron/electron) (MIT) — the window and shell.
- [Node.js](https://github.com/nodejs/node) (MIT) — the runtime the dsh engine
  runs on, downloaded verbatim from nodejs.org and verified by SHA256. Node.js
  bundles its own third-party components under their own licenses; see
  [Node's LICENSE](https://github.com/nodejs/node/blob/main/LICENSE).

Lớp vỏ cũng đóng gói kèm hai binary nguyên trạng: Electron (MIT) cho cửa sổ, và
Node.js (MIT) làm runtime cho engine dsh — tải thẳng từ nodejs.org và đối chiếu
SHA256. Node.js kèm theo các thành phần bên thứ ba với giấy phép riêng của
chúng.
