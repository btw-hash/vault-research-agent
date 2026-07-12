# Architecture Decisions

Short ADR-style notes for decisions worth remembering later.

## ADR-1 — Postgres + pgvector over a dedicated vector DB

**Decision:** Aurora Notebook's embeddings live in Postgres with the `pgvector`
extension rather than a dedicated vector database (e.g. Pinecone).

**Why:** note counts per user are small (thousands, not millions), so approximate
nearest-neighbor search at that scale doesn't need a specialized engine. Keeping
embeddings in the same database as note metadata avoids a second system to operate,
and lets search filters (date range, folder) be plain SQL joins instead of a
cross-system query.

## ADR-2 — stdio MCP for internal tool integration

**Decision:** internal tool servers (vault access, analytics) are exposed via MCP over
stdio, not HTTP.

**Why:** stdio transport means a tool server is just a child process — no port to
manage, no auth token to rotate for local development, and the same server binary
works whether it's called from a CLI script or an agent orchestrator. HTTP MCP is kept
as an option for anything that needs to run as a long-lived shared service later.

## ADR-3 — Analytics MCP server as a single integration point for Fleet Dashboard

**Decision:** Fleet Dashboard reads service health through one internal analytics MCP
server instead of calling each service's health API directly.

**Why:** with five-plus services, direct polling meant five auth configs and five
failure modes to handle in the dashboard. One MCP server centralizes the polling,
caching, and retry logic; the dashboard just calls tools. See [[Session History]] for
the rollout entry and [[Fleet Dashboard]] for how the status lamps consume it.
