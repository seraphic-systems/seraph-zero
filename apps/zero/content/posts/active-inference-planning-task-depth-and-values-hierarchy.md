---
title: Active Inference
date: "2026-10-30"
description: "Ear"
draft: false
---

# Active Inference Planning System

Oct 19, 2026 · @Tim

A Jira-style tracker built on active inference: goals are observable Outcomes, plans are competing Bets with explicit predictions, tasks are either Build or Learn, and every closed bet records what actually happened. Teams can onboard by learning three additions to the Jira they already know.

## At a glance

&#91;embedded content: the planning hierarchy · 5 levels\]

Each level sets what counts as success for the one below; evidence that predictions missed travels back up to the level that made them.

## Core idea: split goals from work

Jira's epic mixes "what we want" with "what we're doing." This system separates them into two objects.

- **Outcomes** are the goals, stated as something observable: "Trial-to-paid conversion above 8%," not "Improve onboarding."
- **Bets** are plans that are expected to move an outcome. An outcome can hold several bets at once: one active, the others parked as alternatives.

Plans compete for the same goal instead of being the goal. Finishing every task is not success unless the observed outcome matches the target.

## Objects and fields

Five object types, each a level slower than the one below it. Aims are optional for small teams.

| Object  | Links up to               | Key fields                                                                                                                                               | Reviewed  |
| ------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Value   | —                         | Statement; type (aspiration or guardrail)                                                                                                                | Yearly    |
| Aim     | Value(s)                  | Qualitative direction                                                                                                                                    | Yearly    |
| Outcome | Value(s) or Aim(s)        | Signal, target, how it's checked                                                                                                                         | Quarterly |
| Bet     | Outcome (or a parent bet) | We expect…; confidence (low / medium / high); key unknowns; Impact, Learning, Cost; guardrail check; status (active / parked); observed result; surprise | Weekly    |
| Task    | Bet                       | Type (Build or Learn); checklist; owner                                                                                                                  | Daily     |

A bet's **surprise** field takes three values: as expected, better than expected, worse than expected.

## Sub-tasks: keep tasks to one level

Tasks stay flat. Each task gets a plain **checklist** for its smaller steps, and those steps are not tracked tickets.

In a deep temporal model, a level earns its place by having its own timescale and its own predictions. A sub-task almost never has either: it is just the parts of the task broken out, so tracking it adds overhead without adding anything you would learn from.

**Rule: depth is earned by uncertainty, not size.**

- A task that is big but obvious gets a longer checklist.
- A task that turns out to contain a real unknown ("we don't know if the audio engine can handle this latency") is **promoted to a bet**, with its own "We expect…" line and confidence rating. Its steps become tasks under it.

Nesting therefore happens through **bets under bets**, not tasks under tasks. A large bet can contain smaller bets when each layer has something real to predict and check. Every level that exists is one where you could be surprised.

## Relating Outcomes to higher-level values

Outcomes link up through a chain: **Values → Aims → Outcomes → Bets → Tasks**. In active inference, the top of the hierarchy holds the slowest, most stable priors (the agent's beliefs about what kind of thing it is), and each level sets the preferences for the level below it.

| Level    | What it is                                | Changes about   | Example                                                    |
| -------- | ----------------------------------------- | --------------- | ---------------------------------------------------------- |
| Values   | Who we are; not measurable                | Rarely, if ever | Tools that respect musicians' creative flow                |
| Aims     | Long-horizon direction, still qualitative | Yearly          | Become the go-to resampling tool for independent producers |
| Outcomes | Observable and targeted                   | Quarterly       | WAU > 500; median session > 20 min                         |
| Bets     | Competing plans                           | Weekly review   | Free tier with watermark                                   |
| Tasks    | Concrete work                             | Daily           | Implement watermark                                        |

Aims are optional for minimal onboarding: a small team can link Outcomes straight to Values and add Aims later.

### Values do two jobs

1. **They generate outcomes.** Every Outcome links to at least one Value it serves; many-to-many links are fine. An Outcome that serves no Value is a red flag: you are optimizing something nobody cares about.
2. **They act as guardrails.** Some values are lines not to cross: "no dark patterns," "never lose user audio." In the theory these are outcomes with extremely low prior probability, so any policy predicted to cause them is effectively ruled out. In the tool, each bet has a **guardrail checkbox**: "Does this bet risk violating any guardrail?" A yes blocks it until someone discusses it.

### Surprise travels all the way up

The most important higher-level surprise is the **Goodhart check**: Outcome targets are being hit, but the Value doesn't feel served. For example, WAU is up but users complain the tool feels pushy. That is evidence the Outcome is a bad proxy for the Value.

Each level's review asks whether the level below is a good stand-in for what it really cares about:

- **Weekly, about bets:** did they move the outcome as predicted?
- **Quarterly, about outcomes:** did hitting them actually serve the values?
- **Yearly, about values and aims:** are these still true about who we are?

## The feedback loop

Prediction error, not ticket status, decides what gets attention.

1. **Predict.** Every bet starts with a "We expect…" line and a confidence rating.
2. **Learn first when unsure.** A low-confidence bet starts with Learn tasks that shrink its key unknowns before Build tasks begin.
3. **Close out with "what happened?"** When a bet finishes, or at checkpoints along the way, someone records the observed result and marks the surprise.
4. **Flag upward.** A "worse than expected" bet automatically flags its outcome. Flags set the review agenda.
5. **Re-weight weekly.** For each flagged outcome, the review makes one call:
   - keep the current bet,
   - switch to a parked alternative, or
   - add a Learn task because the team is too uncertain to choose.

The same loop repeats at the slower levels (see _Surprise travels all the way up_ above).

## Prioritization

Each bet is scored on three quick 1–3 scales instead of any free-energy math.

| Score    | Question                                | Theory term     |
| -------- | --------------------------------------- | --------------- |
| Impact   | How much should this move the outcome?  | Pragmatic value |
| Learning | How much would this reduce uncertainty? | Epistemic value |
| Cost     | How much effort or risk does it take?   | —               |

A bet with high Learning and low Impact is a legitimate thing to do early: it makes later choices cheaper. Any bet that fails the guardrail check is blocked until discussed, whatever its scores.

## Playbooks

Routine work runs from templates, not bets. A **playbook** (release checklist, client onboarding) generates its tasks automatically, with no prediction or confidence fields. This is the habit prior: familiar work skips deliberation, and the bet machinery is reserved for work that is actually uncertain. A playbook run that goes badly is a sign the work isn't routine anymore and should become a bet.

## Board and onboarding

The board keeps familiar columns plus one at the end:

**Backlog → In progress → Done → Checked**

A bet sits in Done until someone has recorded whether it did what it predicted.

A new teammate learns three things:

1. Epics are split into **Outcomes** (what we want to see) and **Bets** (how we think we'll get there).
2. Every bet has a **"We expect…"** line and a **confidence** rating.
3. Tasks are **Build** or **Learn**, and closing a bet means writing **what actually happened**.

## Worked example

If Bet A comes back worse than expected, the review already has Bet B parked, and the record shows why the team switched.

- **Value:** Tools that respect musicians' creative flow
  - **Outcome:** Weekly active users of the plugin above 500
    - **Bet A (active):** Free tier with a watermark. _Expect +150 WAU. Confidence: low. Unknown: will free users convert?_
      - Learn: interview 5 trial users about pricing
      - Learn: landing-page test, free vs. trial
      - Build: implement the watermark
    - **Bet B (parked):** Bundle with sample packs. _Expect +80 WAU. Confidence: medium._

## Toward a full system

The extension is to treat the tracker as one view onto a **generative model of the organization**. Active inference needs four things: a model of hidden states, observations that update it, preferences, and policies that act on the world. The tracker so far covers only the last two.

### Observations: close the loop automatically

Each Outcome's signal becomes a live query against real data (analytics, revenue, support tickets, CI, telemetry) rather than a value typed in at close-out. The system reads the signal on a cadence, compares it to the active bet's prediction, and raises the surprise flag itself. Build this as a thin **signal layer**: each Outcome points at a connector plus a transformation, and everything downstream consumes a normalized time series.

### Hidden state: assumptions as first-class objects

The beliefs that plans rest on ("our users are mostly hobbyists," "latency under 10 ms is table stakes") become **Assumptions**, each with a confidence and links to the bets that depend on it. A bet's key unknowns are references into this store. When an assumption's confidence drops, every dependent bet is flagged at once.

### Policies: the system proposes, humans dispose

With live signals and explicit assumptions, candidate bets can be generated (from templates or a model) and scored on Impact, Learning and Cost against current beliefs. Reviews become a ranked list of proposed moves with reasoning attached. Anything that risks a guardrail Value is filtered before it reaches a human, and execution stays human-triggered.

### Other tools as views or sensors

- **Docs and specs** attach to bets as the plan's description and to assumptions as their evidence.
- **Chat and meetings** are a sensor: a review that ends in "switch to Bet B" is captured as a decision event.
- **Code and CI** report Build-task completion and quality signals without manual status updates.
- **Analytics** feed the signal layer directly.

### Architecture

&#91;embedded content: system architecture · sensors, model, inference, views\]

Sensors write observations into the model store; the inference service reads them against predictions and writes back surprise flags and bet scores; views read the current state.

The core is event-sourced, so predictions, observations and decisions keep their full history. That record of what was expected, observed and decided is the one thing no current tool provides, and it is the training signal needed if the proposal step is ever to improve.

### Build order

1. Signal layer for a single Outcome.
2. Assumptions store, linked to bets.
3. Decision-event capture from reviews.
4. Automated proposal and scoring, once there is a history to score against.

## Appendix: mapping to active inference

| In the tool                 | In active inference                                         |
| --------------------------- | ----------------------------------------------------------- |
| Values, Aims                | Slow, high-level priors about what kind of agent this is    |
| Outcome target              | Prior preferences over observations (C)                     |
| Bet                         | Policy: a sequence of actions, one hypothesis among several |
| Weekly re-weighting         | Posterior over policies, driven by expected free energy     |
| Impact score                | Pragmatic value                                             |
| Learning score, Learn tasks | Epistemic value (information gain)                          |
| Guardrail                   | Outcome with near-zero prior probability                    |
| Playbook                    | Habit prior over policies (E)                               |
| Surprise flag               | Prediction error passed up the hierarchy                    |
| Bets under bets             | Deep temporal model: each level slower than the one below   |

Reference: Friston et al., 2017, _Deep temporal models and active inference_.
