Ah — **that changes my recommendation somewhat**.

If the simulator's purpose is to *visually demonstrate the learning process*, I would actually lean toward a **contextual bandit**, even for the first version.

The reason is that your simulator can make the distinction between **exploration and exploitation visible**, which is one of the nicest things about this problem.

### What I would build

Have the system repeatedly do:

```text
             ┌─────────────────────┐
             │ Current graph/layout│
             └──────────┬──────────┘
                        │
                        ▼
                observe features
                        │
                        ▼
                 ┌─────────────┐
                 │   Bandit    │
                 │   policy    │
                 └──────┬──────┘
                        │
                FA2 parameters
                        │
                        ▼
                 ┌─────────────┐
                 │ ForceAtlas2 │
                 └──────┬──────┘
                        │
                        ▼
                   new layout
                        │
                  calculate reward
                        │
                        ▼
                  update policy
                        │
                        └──────► repeat
```

And your UI shows the graph **changing after every action**.

That gives you a very intuitive visual:

> "The agent tried this set of parameters → the graph became worse → it learned not to do that."

Then:

> "It tried this configuration → clusters became cleaner → reward increased → it tries similar configurations more often."

That's a much better demonstration of learning than BO, where a lot of the interesting optimization is hidden inside the surrogate model.

---

## I'd make the action space very small

Don't start with all ForceAtlas2 parameters.

Something like:

[
a = (\text{scaling},\text{gravity},\text{edge-weight influence})
]

And discretize them initially.

For example:

```text
scaling:       low / medium / high
gravity:       low / medium / high
edge influence: low / medium / high
```

That's only:

[
3^3 = 27
]

possible actions.

Now you have an incredibly simple contextual bandit.

The agent sees the graph, chooses one of 27 parameter configurations, runs FA2 for e.g. 100–500 iterations, and gets a reward.

---

## The visual feedback becomes the experiment

I'd put these side-by-side:

**Left:** graph visualization

**Right:** learning state

```text
Episode:              143
Best reward:          0.82
Current reward:       0.79
Average reward:       0.67

Current parameters
  Scaling             1.8
  Gravity             0.4
  Edge influence      0.7

Best parameters
  Scaling             2.1
  Gravity             0.3
  Edge influence      0.6

Exploration           23%
Exploitation          77%
```

And underneath, show reward over time.

Those numbers are just illustrative—the important thing is that **the graph itself becomes the primary visualization of the learning curve**.

---

## One subtle change I'd make

Don't necessarily reset the graph after every action.

Instead, I'd have **two modes**.

### Training mode

Start with the same graph:

```text
random initial layout
       ↓
 action 1
       ↓
 FA2
       ↓
 action 2
       ↓
 FA2
       ↓
 action 3
       ↓
 ...
```

So you can literally watch the layout converge.

### Evaluation mode

Reset to the same initial layout and let the learned policy control it:

```text
initial graph
     ↓
learned policy
     ↓
beautiful layout
```

Then you can press **"Compare to baseline"** and show:

```text
ForceAtlas2 defaults       Learned policy
       graph                    graph
        ↓                        ↓
     reward .43               reward .81
```

That's a very compelling demo.

---

# I would also separate "learning" from "FA2 convergence"

This is important.

If you change parameters every 10 iterations, the user may interpret the graph's movement as the RL agent learning, when much of it is simply ForceAtlas2 doing its normal optimization.

So I'd use something like:

**One bandit step = 200 FA2 iterations.**

Then freeze the graph and show:

> **Agent chose:**
> scaling = 2.0, gravity = 0.5
> **Reward:** 0.73
> **Improvement:** +0.08

Then the next decision.

That makes causality visually obvious.

---

## And eventually...

Once you've got this working, you can make the transition:

### Version 1

**Multi-armed bandit**

No graph context.

> "Which of these 27 parameter configurations is best?"

### Version 2

**Contextual bandit**

Give it graph features.

> "Given this graph, which configuration is likely to be best?"

### Version 3

**Sequential RL**

The agent chooses parameter changes during the simulation.

> "Given the current state of the layout, what should I do next?"

That progression would make a **really nice interactive research/demo system**, because users can literally watch the algorithm progress from brute-force experimentation → learning graph-specific preferences → dynamically controlling the layout.

For your specific goal of **"I want to see the learning system getting better in real time"**, I'd choose **contextual bandit over Bayesian optimization** for the first interactive version.
