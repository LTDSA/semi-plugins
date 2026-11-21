# FairPlay audio-key unwrap

Source: FD-/RPiPlay, revision `64d0341ed3bef098c940c9ed0675948870a271f9`,
`lib/playfair/`. Original GPLv3 license is retained in LICENSE.md. The algorithm is
OmgHax/playfair, also used by MiAir's Python Fairplay3 port. Upstream C algorithm
files are unmodified; wasm-wrapper.c is Semi's GPL-3.0-only fixed-buffer boundary.

The checked-in ../../playfair.wasm is built with Zig 0.14.1. A developer can rebuild
from the repository root using `SEMI_ZIG=/path/to/zig npm run miplay:fairplay-build`.
The build script and all algorithm sources accompany the application. Normal
plugin/application builds copy this portable module and do not need a compiler.
The module has no imports, no WASI host dependency and a fixed 1 MiB memory limit.
It is loaded lazily in the plugin's Node background only when FairPlay is used.

Inputs: 164-byte second setup request (message3), 72-byte fpaeskey. Output: 16-byte
AES key. Node validates lengths, header and mode before invoking WASM; buffers are
cleared after each call and session key buffers are cleared on teardown. No keys,
setup bodies or audio-stream access URLs are logged.

Tests use deterministic synthetic inputs independently evaluated by the original
MiAir `fairplay3.py` revision 4416ffd679340581ea64eddaeff6672d20fad85a. They cover
all four modes and a real RTSP / AES-encrypted RTP / compressed ALAC / WAV loopback.
The Python reference was used only to generate fixtures; it is not a build, test,
or application runtime dependency.
