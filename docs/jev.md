# Jev (`jev`, `jev-openrouter`)

Jev is TypeSafe's System One decision model: content (`state`) plus named typed questions in, typed answers with calibrated probabilities out. The [Jev app](./app-bundles.md) has two ways to connect, each with the Owner's own key:

| Component              | Endpoint                                         | Models                     | Key check         |
| ---------------------- | ------------------------------------------------ | -------------------------- | ----------------- |
| `jev@1.0.0`            | `POST https://api.typesafe.ai/v1/systemone`      | `jev-latest`, `jev-1.14.0` | `GET /v1/models`  |
| `jev-openrouter@1.0.1` | `POST https://openrouter.ai/api/alpha/decisions` | `typesafe/jev-1.14`        | `GET /api/v1/key` |

Both expose one read tool, **Ask Jev** (`jev.ask`), default **allow**, so Bots and Service workflows (which may call only read tools that allow) can use it. Its body is `{ model, state, questions }`, where each question is `choice` (criteria: option → description), `score` (criteria: 1–10 ordered levels) or `noul` (optional `{true, false}` criteria). The identical tool id lets the application treat either connection the same way, including its workflow Jev node.

Box (image location) and images are not offered yet: they need image assets and TypeSafe's `TypeSafe-Danger-Zone-Images` header. TypeSafe's long-context header is exposed as an optional `headers` argument.

`jev-openrouter@1.0.0` also offered `typesafe/jev-latest`, which OpenRouter rejects with HTTP 400 (only the pinned model is served there), so 1.0.1 offers only `typesafe/jev-1.14`. Both specs are reviewed local selections; OpenRouter's Decisions API is in alpha and adds a `refusal` answer type and `usage.cost`, which callers must handle.

## Release prerequisites

- Credential-free provider registrations `typesafe-api-v1` and `openrouter-decisions-v1` in production, like `resend-api-credentials-v1`.
- Live key acceptance is pending until an Owner connects a real key.
