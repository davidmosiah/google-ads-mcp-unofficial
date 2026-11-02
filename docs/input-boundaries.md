# MCP input boundaries

Tool arguments are limited to 10,000 combined object members/array elements before
schema parsing on both stdio and HTTP. Exactly-at-limit input remains accepted.
This is not a complete process-memory/protocol limit.

HTTP keeps its 1 MiB JSON byte limit and rejects compressed request bodies,
including gzip, deflate and Brotli. Clients must send uncompressed JSON.
The test suite verifies normal/boundary/recovery, all compression formats,
malformed JSON and oversized bodies with only synthetic input/loopback traffic.

The MCP binary starts stdio without arguments as documented. Explicit CLI commands
and HTTP mode retain their routes. No provider credentials or live mutations are
used in these tests. HTTP authentication and provider permissions are unchanged.

Dependency updates target patched SDK/Zod and affected transitive libraries with
official npm lock resolution and lifecycle scripts disabled during installation.
A zero-known-vulnerability audit is a snapshot, not proof of vulnerability absence.
