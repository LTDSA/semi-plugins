Receiver subset from @sonn-audio/node-airplay 0.1.2 (published npm archive),
https://github.com/sonn-audio/node-airplay . Original LICENSE and NOTICE are retained.
The receiver, ALAC decoder, Apple key and NTP helpers are used; the ALAC encoder
is retained solely for protocol-test/reference use. No AirPlay 2 implementation is used.

Semi changes: explicit IPv4 listener binding; bounded RTSP input; separate bounded probe connections and a single active audio session; malformed request/codec error handling; L16 conversion; bounded ALAC configuration/frame sizes and truncated-input checks; FLUSHBUFFERED
compatibility. PCM is forwarded into the plugin-owned authenticated WAV endpoint.

Discovery declarations follow the previously working MiAir RAOP record (vn=65537,
vs=105.1, da/sf/pw/fn/ft). AAC is excluded from codec/feature claims because this
receiver implements PCM and ALAC only.

MiAir-compatible setup responses are in ../fairplay-setup.mjs, with attribution to
the original PlayFair reference. The setup state is retained per connection and fpaeskey is unwrapped by the
separate playfair WASM module; its sources, build instructions and GPLv3 license
are in playfair/. No encrypted key material is logged.

OPTIONS probes no longer reserve the audio session or stop it on disconnect.
Responses carry explicit lengths and per-connection diagnostics. Playback state
requires ANNOUNCE/SETUP/RECORD; OPTIONS alone is not evidence of audio transfer.
