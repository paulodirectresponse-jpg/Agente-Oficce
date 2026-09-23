# Kimi Code — Agent Office UX V2 instructions

Read the root `AGENTS.md` first. These rules are additional and specific to the UX V2 implementation.

## Mission

Implement the approved Agent Office UX V2 for vibe coders.

Do not simplify the backend. Simplify the user's experience.

Required references:

- `AGENTS.md`
- `DESIGN.md`
- `docs/plans/AGENT_OFFICE_UX_V2.md`
- `docs/plans/UX_V2_IMPLEMENTATION_PLAN.md`
- `docs/plans/UX_V2_IMPLEMENTATION_STATUS.md`

Use the repo-local skills under `.agents/skills/` when relevant.

## Git is mandatory persistence

Work only on:

`ux-v2-redesign`

Every coherent change must be committed and pushed to the repository.

Never leave meaningful work only in the local working tree because the session may end or credits may run out.

### Required checkpoint loop

1. inspect current status + recent Git history;
2. make one coherent change;
3. run relevant verification;
4. update `docs/plans/UX_V2_IMPLEMENTATION_STATUS.md`;
5. commit;
6. push to `origin/ux-v2-redesign`;
7. continue.

Prefer several clean remote commits over one huge local batch.

## Credit/time emergency rule

If remaining credits/time look low:

- stop beginning new features;
- make current tree understandable;
- update the status file;
- commit;
- push;
- report the exact remote SHA.

Do this even if the current macro phase is incomplete.

## Do not merge main

Do not merge `ux-v2-redesign` into `main` without explicit user instruction.

Do not force-push.

## Do not rebuild working backend systems unnecessarily

The UX redesign should first recompose existing APIs and views.

Backend changes must be:

- necessary;
- minimal;
- additive when possible;
- tested;
- documented in the status file.

Preserve Blocks 1–11 invariants.

## UI behavior

Default UI is for a non-expert vibe coder.

Do not expose technical concepts merely because they exist.

Use progressive disclosure.

If unsure whether something should stay permanently visible, default to hiding it behind a clear contextual action unless it is necessary to:

- act now;
- understand a consequence;
- approve risk;
- recover from a problem.

## Stop condition

A checkpoint is not complete until its code and handoff status exist on the remote repository.
