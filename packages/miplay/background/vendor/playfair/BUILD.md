# Rebuild the portable module

Use Zig 0.14.1. No Python is required. From this source directory:

```sh
zig cc -target wasm32-wasi -mexec-model=reactor -O2 -fwrapv -fno-strict-aliasing -DNDEBUG \
    playfair.c omg_hax.c modified_md5.c sap_hash.c hand_garble.c wasm-wrapper.c \
    -Wl,--export=key_message_buffer -Wl,--export=wrapped_key_buffer \
    -Wl,--export=plain_key_buffer -Wl,--export=unwrap_key -Wl,--export=wipe_key_buffers \
    -Wl,-z,stack-size=65536 -Wl,--initial-memory=1048576 -Wl,--max-memory=1048576 \
    -Wl,--strip-all -o ../../playfair.wasm
```

The repository wrapper is `scripts/build-miplay-fairplay.cjs`. Compile flags retain
32-bit wrapping semantics and disable strict-aliasing assumptions required by the
original implementation. The result has no imports and can be loaded with plain
WebAssembly in Node, without a WASI host or OS-specific native addon.
