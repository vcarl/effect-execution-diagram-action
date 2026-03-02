# Literature Review: Visualizing Functional Programming Patterns

Prior work on visualizing functional programming constructs — effect pipelines,
monadic composition, dataflow graphs — is sparse. Most ecosystems offer runtime
profiling and tracing tools but very little in the way of static analysis that
produces structural diagrams from source code.

This review covers both practical tools and the academic foundations that inform
how diagrams should be designed, particularly at scale.

---

## Table of Contents

- [Practical Tools](#practical-tools)
  - [Static Analysis → Diagram Tools](#static-analysis--diagram-tools)
  - [Runtime Visualization Tools](#runtime-visualization-tools)
  - [Interactive / Educational Tools](#interactive--educational-tools)
- [Academic Foundations](#academic-foundations)
  - [Graph Legibility](#graph-legibility)
  - [Visualizing Large-Scale Software](#visualizing-large-scale-software)
  - [Program Comprehension](#program-comprehension)
  - [Dataflow Visualization](#dataflow-visualization)
  - [Compositional & Categorical Visualization](#compositional--categorical-visualization)
  - [Effect Systems](#effect-systems)
  - [Program Slicing for Functional Languages](#program-slicing-for-functional-languages)
- [Observations](#observations)

---

## Practical Tools

### Static Analysis → Diagram Tools

**Travesty** (Akka Streams, Scala)
https://github.com/mikolak-net/travesty

Generates structural diagrams of Akka Streams topologies. Uses Akka's internal
`Traversal` API — the stack-like structure describing how to construct a running
stream — to produce both graphical and textual representations. The closest
existing precedent for extracting a diagram from a streaming/pipeline DSL via
static analysis.

**Calligraphy** (Haskell)
https://github.com/jonascarpay/calligraphy

A call graph and source code visualizer that works on GHC-generated `.hie`
files, giving it access to full type information. Outputs Graphviz (dot).
Follows an "80% accuracy for 20% effort" philosophy — simple and useful rather
than perfectly precise. The most relevant Haskell analog to this project.

**SourceGraph** (Haskell)
https://hackage.haskell.org/package/SourceGraph

Statically analyzes Haskell source code using graph-theoretic techniques.
Creates call graphs directly from source and produces an HTML report showing how
different parts of a program interact.

**Apache Flink Plan Visualizer**
https://nightlies.apache.org/flink/flink-docs-release-1.13/docs/dev/execution/execution_plans/

Renders execution DAGs from Flink dataflow programs. Programs are transformed
through four levels — StreamGraph, JobGraph, ExecutionGraph, and physical
execution plan — and the visualizer takes JSON execution plans and renders
annotated graphs.

**Apache Spark DAG Visualization**
https://www.databricks.com/blog/2015/06/22/understanding-your-spark-application-through-visualization.html

Spark's web UI displays the execution DAG for each job, showing RDD dependency
chains. Similar in spirit to Flink's plan visualizer.

**General call graph tools:**
- **go-callvis** (https://github.com/ondrajz/go-callvis) — visual call graphs
  for Go using pointer analysis and Graphviz.
- **pyan** (https://github.com/davidfraser/pyan) — static call dependency
  graphs for Python.
- **callGraph** (https://github.com/nickoala/callgraph) — cross-language call
  graph generator supporting TypeScript, Scala, Haskell, and others.

### Runtime Visualization Tools

These don't do static analysis but represent the state of the art for
understanding FP programs at runtime.

- **ZIO Profiling** (https://zio.dev/zio-profiling/) — sampling profiler for ZIO
  using `FiberRef`-based tracking and a compiler plugin that auto-tags every
  `def`/`val` returning a ZIO effect. Results render as flame graphs.
- **ZIO Insight** (https://github.com/zio/zio-insight) — real-time metrics
  dashboard for ZIO 2 via WebSocket and ScalaJS/Laminar client.
- **ThreadScope** (https://wiki.haskell.org/ThreadScope) — graphical viewer for
  GHC thread profiles showing CPU activity per Haskell Execution Context.
- **ghc-vis** (https://hackage.haskell.org/package/ghc-vis) — live visualization
  of Haskell data structures in GHCi *without forcing evaluation*, preserving
  laziness and sharing.
- **Observer** (https://www.erlang.org/doc/apps/observer/observer_ug.html) —
  built-in OTP GUI showing live supervision trees with drill-down.
- **Phoenix LiveDashboard**
  (https://github.com/phoenixframework/phoenix_live_dashboard) — web-based
  process/supervision tree introspection for Phoenix apps.
- **Akka Visual Mailbox** (https://github.com/ouven/akka-visualmailbox) —
  actor message flow visualization (nodes = actors, edges = messages, thickness =
  volume).

### Interactive / Educational Tools

- **RxMarbles** (https://rxmarbles.com/) — interactive marble diagrams for Rx
  operators. The most successful visual metaphor for functional pipelines, but
  hand-crafted/interactive rather than auto-generated from source.
- **ThinkRx** (https://thinkrx.io/) — playground for RxJS, Bacon.js, and Kefir
  with instant marble diagrams.
- **Livebook** (https://livebook.dev/) — Elixir's interactive notebook with
  built-in Mermaid.js and Vega-Lite support. Pipeline diagrams possible but
  manual.

---

## Academic Foundations

### Graph Legibility

The graph drawing community has established empirical criteria for what makes a
diagram readable. The central finding: **minimizing edge crossings is the single
most important factor** for comprehension, outweighing all other aesthetics.

**Purchase (1997).** "Which Aesthetic has the Greatest Effect on Human
Understanding?" *Graph Drawing (GD '97).* Controlled experiments demonstrated
that edge crossing minimization had the strongest effect on task performance —
more than symmetry, uniform edge length, or bend minimization. One of the most
cited empirical results in graph drawing.

**Purchase, Carrington, and Allder (2002).** "Metrics for Graph Drawing
Aesthetics." *Journal of Visual Languages and Computing.* Empirically validated
a hierarchy of aesthetic criteria: edge crossings > bends > symmetry > edge
length uniformity.

**Ware, Purchase, Colpoys, and McGill (2002).** "Cognitive Measurements of
Graph Aesthetics." *Information Visualization.* Extended Purchase's work with
cognitive load measurements, confirming that edge crossings impose the highest
cognitive cost.

**Sugiyama, Tagawa, and Toda (1981).** "Methods for Visual Understanding of
Hierarchical System Structures." *IEEE Transactions on Systems, Man, and
Cybernetics.* The Sugiyama algorithm (layered graph drawing) — nearly every tool
that renders DAGs, call graphs, or flowcharts uses a variant. Works in four
phases: cycle removal, layer assignment, crossing reduction, coordinate
assignment. This is what Mermaid uses internally.

**Eades (1984).** "A Heuristic for Graph Drawing." *Congressus Numerantium.*
Introduced the spring-embedder (force-directed) approach, spawning an entire
family of algorithms (Fruchterman-Reingold, Kamada-Kawai) that dominate
undirected graph layout.

**Holten (2006).** "Hierarchical Edge Bundles." *IEEE Transactions on
Visualization and Computer Graphics.* Introduced edge bundling for hierarchical
structures, dramatically reducing visual clutter in large dependency graphs.
Widely adopted in software dependency visualization.

**Ghoniem, Fekete, and Castagliola (2004).** "A Comparison of the Readability
of Graphs Using Node-Link and Matrix-Based Representations." *IEEE InfoVis.*
Showed that **matrix representations outperform node-link diagrams for large,
dense graphs** (above ~20 nodes), while node-link is better for sparse graphs
and path-finding tasks. A critical result: large dependency structures probably
should not be shown as traditional graph diagrams.

**Battista, Eades, Tamassia, and Tollis (1998).** *Graph Drawing: Algorithms
for the Visualization of Graphs.* Prentice Hall. The definitive textbook on
graph drawing algorithms.

### Visualizing Large-Scale Software

#### Architecture Recovery

**Murphy, Notkin, and Sullivan (1995).** "Software Reflexion Models: Bridging
the Gap between Source and High-Level Models." *SIGSOFT FSE.* Introduced
reflexion models — a developer's hypothesized architecture is compared against
actual source structure, with convergences, divergences, and absences
highlighted. One of the most influential papers in architecture recovery because
it directly addresses the gap between intended and actual architecture.

**Koschke (2009).** "Architecture Reconstruction." Chapter in *Software
Engineering* (Springer). Comprehensive survey of architecture recovery
techniques covering static analysis, dynamic analysis, clustering, and
visualization.

**Ducasse and Pollet (2009).** "Software Architecture Reconstruction: A
Process-Oriented Taxonomy." *IEEE Transactions on Software Engineering.*
Classified architecture reconstruction approaches into a taxonomy based on the
reconstruction process.

#### Scalable Visual Encodings

**Wettel and Lanza (2007).** "Visualizing Software Systems as Cities."
*VISSOFT.* Introduced CodeCity: buildings represent classes (height = number of
methods, footprint = number of attributes), arranged in districts representing
packages. Leverages spatial cognition and scales to large systems. The most
empirically validated large-scale software visualization.

**Wettel, Lanza, and Robbes (2011).** "Software Systems as Cities: A Controlled
Experiment." *ICSE.* Showed CodeCity improved correctness and completion rate for
program comprehension tasks compared to standard IDE-based exploration.

**Shneiderman (1992).** "Tree Visualization with Tree-Maps: 2-D Space-Filling
Approach." *ACM Transactions on Graphics.* The original treemap paper. Treemaps
became one of the dominant techniques for visualizing hierarchical software
structures.

**Sangal, Jordan, Sinha, and Jackson (2005).** "Using Dependency Models to
Manage Complex Software Architecture." *OOPSLA.* Introduced the Design
Structure Matrix (DSM) for software — a square matrix where rows/columns are
modules and cells indicate dependencies. Scales much better than node-link
diagrams for dense dependency graphs.

#### Focus+Context and Progressive Disclosure

**Furnas (1986).** "Generalized Fisheye Views." *CHI '86.* The original fisheye
view paper — show detail for current focus while maintaining context through
progressive distortion/abstraction. Applied extensively to software
visualization.

**Lamping, Rao, and Pirolli (1995).** "A Focus+Context Technique Based on
Hyperbolic Geometry for Visualizing Large Hierarchies." *CHI '95.* Hyperbolic
tree browser for exploring large hierarchies with distortion-based focus.

**Elmqvist and Fekete (2010).** "Hierarchical Aggregation for Information
Visualization: Overview, Techniques, and Design Guidelines." *IEEE TVCG.*
Systematic treatment of hierarchical aggregation for large datasets — directly
applicable to software architecture diagrams that must show systems at multiple
scales.

**van Ham and Perer (2009).** "Search, Show Context, Expand on Demand." *IEEE
TVCG.* Degree-of-interest model for graph exploration: visualization starts
minimal and expands based on user interest.

**Abello, van Ham, and Krishnan (2006).** "ASK-GraphView: A Large Scale Graph
Visualization System." *IEEE TVCG.* Addressed graphs with millions of nodes
through hierarchical clustering and progressive refinement.

#### Software Cartography

**Storey, Fracchia, and Muller (1999).** "Cognitive Design Elements to Support
the Construction of a Mental Model during Software Exploration." *Journal of
Systems and Software.* Their SHriMP tool (Simple Hierarchical Multi-Perspective)
provides nested, zoomable views of software structure — zoom into a package to
see its classes, into a class to see its methods. The visualization at each
level of zoom is self-contained and meaningful.

**DeLine, Venolia, and Rowan (2010).** "Software Development as Seen Through Its
Artifacts." Microsoft Research. Code Canvas — an infinite zooming surface for
code where files are placed spatially. Demonstrated that spatial memory aids
navigation in large codebases.

**Lungu and Lanza (2007).** "Exploring Inter-Module Relationships in Evolving
Software Systems." *CSMR.* The Softwarenaut tool for interactive module-level
exploration with progressive disclosure.

### Program Comprehension

#### Foundational Models

The program comprehension literature establishes how developers actually read and
understand code, providing a basis for what visualizations should support.

**Brooks (1983).** "Towards a Theory of the Comprehension of Computer Programs."
*International Journal of Man-Machine Studies.* Proposed a top-down
hypothesis-driven model: programmers form hypotheses about program purpose and
verify them against code.

**Soloway and Ehrlich (1984).** "Empirical Studies of Programming Knowledge."
*IEEE TSE.* Introduced "plans" and "rules of discourse" — expert programmers
recognize stereotypical code patterns and expect conventions. Violations
significantly impair comprehension.

**Pennington (1987).** "Stimulus Structures and Mental Representations in Expert
Comprehension of Computer Programs." *Cognitive Psychology.* Programmers build
both a **program model** (what the code does, control flow) and a **domain
model** (what it means in the real world). The program model is built first.
Effective visualizations should support both.

**Von Mayrhauser and Vans (1995).** "Program Comprehension During Software
Maintenance and Evolution." *IEEE Computer.* Integrated Brooks, Soloway/Ehrlich,
and Pennington into a unified framework: programmers switch between top-down,
bottom-up, and knowledge-based strategies depending on familiarity.

**Letovsky (1987).** "Cognitive Processes in Program Comprehension." *Journal of
Systems and Software.* Documented that programmers don't read code linearly —
they jump between locations driven by questions that arise during reading.

#### What Developers Actually Ask

**LaToza, Garber, and Myers (2007).** "Program Comprehension as Fact Finding."
*ESEC/FSE.* Studied professional developers and found comprehension is driven by
specific questions, often about control flow and data flow. The main difficulty
was understanding runtime behavior of code with complex control flow — exactly
the kind of thing execution flow diagrams aim to address.

**LaToza and Myers (2010).** "Developers Ask Reachability Questions." *ICSE.*
Found that a dominant category of developer questions during comprehension are
**reachability questions** — "can this code reach that code? under what
conditions?" This directly motivates execution flow visualization.

#### Visualization Effectiveness

**Storey, Wong, and Muller (2000).** "How Do Program Understanding Tools Affect
How Programmers Understand Programs?" *Science of Computer Programming.*
Visualization tools (SHriMP) improved comprehension, particularly for unfamiliar
code. Key finding: the **level of abstraction** provided by the tool strongly
influenced comprehension strategy.

**Petre (1995).** "Why Looking Isn't Always Seeing: Readership Skills and
Graphical Programming." *Communications of the ACM.* **Graphical representations
are not automatically better than text.** "Secondary notation" (spatial layout,
grouping, visual cues beyond formal syntax) is critical — poorly laid out visual
programs were *worse* than text. A cautionary result for software visualization.

**Green and Petre (1996).** "Usability Analysis of Visual Programming
Environments: A 'Cognitive Dimensions' Framework." *Journal of Visual Languages
and Computing.* The Cognitive Dimensions framework — visibility, viscosity,
hidden dependencies, closeness of mapping, role-expressiveness — provides a
vocabulary for evaluating software visualization tools.

**Cornelissen, Zaidman, van Deursen, Moonen, and Koschke (2009).** "A Systematic
Survey of Program Comprehension through Dynamic Analysis." *IEEE TSE.*
Comprehensive survey finding most tools used sequence diagrams, call trees, or
custom trace visualizations to aid comprehension.

**Caserta and Zendra (2011).** "Visualization of the Static Aspects of Software:
A Survey." *IEEE TVCG.* Comprehensive survey categorized by what is visualized
(structure, metrics, evolution) and how (2D, 3D, metaphor-based).

**Diehl (2007).** *Software Visualization: Visualizing the Structure, Behaviour,
and Evolution of Software.* Springer. The definitive textbook on the field.

**Merino, Ghafari, Anslow, and Nierstrasz (2018).** "A Systematic Literature
Review of Software Visualization Evaluation." *Journal of Systems and Software.*
Meta-analysis finding many visualization tools lack rigorous empirical
evaluation.

### Dataflow Visualization

**Johnston, Hanna, and Millar (2004).** "Advances in Dataflow Programming
Languages." *ACM Computing Surveys.* Comprehensive survey from the 1970s through
2000s. Key observation: dataflow programs have a natural visual representation
as directed graphs, but it becomes unwieldy beyond ~50 nodes. **Hierarchical
abstraction** (nodes expanding into sub-graphs) is the primary scaling
mechanism.

**Hils (1992).** "Visual Languages and Computing Survey: Data Flow Visual
Programming Languages." *Journal of Visual Languages & Computing.* Cataloged
50+ systems using the box-and-wire metaphor. The key finding: box-and-wire
(transformations as boxes, data as wires) is the dominant paradigm, but it
breaks down at scale due to "spaghetti wiring."

**Banken, Meijer, and Gousios (2018).** "Debugging Data Flows in Reactive
Programs." *ICSE.* RxFiddle — automated visualization of RxJS observable
pipelines. Instruments the Rx runtime to capture observable creation and
subscription graphs, displayed as interactive node-link diagrams. **The single
most relevant prior work to this project.** Key finding: showing the marble
diagram view *alongside* the structural graph view was essential — neither alone
was sufficient for comprehension.

**Hirzel, Soul, Schneider, Gedik, and Grimm (2014).** "A Catalog of Stream
Processing Optimizations." *ACM Computing Surveys.* Discusses how stream
processing topologies are represented as operator graphs (nodes = operators,
edges = data streams). Relevant because `pipe` chains are structurally similar
to stream operator chains.

**Peterson, Hudak, and Elliott (1999).** "Lambda in Motion: Controlling Robots
with Haskell." *PADL.* Early visualization of functional reactive programs
(Fran/Yampa) as signal flow graphs. Conceptually close to what this project
does — a `pipe` chain in Effect-TS is structurally analogous to a signal flow
graph in FRP.

### Compositional & Categorical Visualization

The category theory community has developed rigorous visual languages for
composition that map well onto functional programming constructs. The gap is
accessibility — no one has built tooling that renders these for working
programmers.

#### String Diagrams

**Selinger (2011).** "A Survey of Graphical Languages for Monoidal Categories."
*New Structures for Physics, Lecture Notes in Physics, vol. 813.* The definitive
survey of string diagrams: morphisms as boxes, objects as wires, composition as
wire connection. Sequential composition is vertical stacking, parallel
composition is horizontal juxtaposition. This maps directly onto Effect's `pipe`
(sequential) and `Effect.all` (parallel).

**Marsden (2014).** "Category Theory Using String Diagrams." *arXiv:1401.7220.*
Develops category theory using string diagrams. The monad section is directly
relevant: monadic bind (`>>=` / `flatMap`) is shown as a box consuming an inner
wire, making the "unwrapping" visually explicit.

**"The Graphical Theory of Monads."** *Journal of Functional Programming.*
https://www.cambridge.org/core/journals/journal-of-functional-programming/article/graphical-theory-of-monads/15AD68F2BC02195A7A2F16075BF0A44D
Formal theory of monads using string diagrams as a graphical language for
2-categorical calculations.

**Bonchi, Gadducci, Kissinger, Sobocinski, and Zanasi (2022).** "String Diagram
Rewrite Theory I: Rewriting with Frobenius Structure." *Journal of the ACM.*
Formal theory of string diagram *rewriting* — rules for transforming one diagram
into an equivalent one. Relevant if diagrams should be simplified or normalized.

#### Wiring Diagrams and Operads

**Spivak (2013).** "The Operad of Wiring Diagrams." *arXiv:1305.0297.* Wiring
diagrams as a visual language for composition: boxes with typed input/output
ports, composition nesting boxes inside boxes. These form an operad — a
structure capturing the essence of "things that compose." Probably the most
directly applicable theoretical framework for visualizing Effect-TS:

| Effect-TS construct | Wiring diagram element |
|---|---|
| `Effect<A, E, R>` | Box with output port `A`, error port `E`, requirement ports per service in `R` |
| `pipe` / `flatMap` | Serial wiring: output of one box → input of next |
| `Effect.all` | Parallel juxtaposition: boxes side by side |
| `Layer.provide` | Provider box's output → consumer box's requirement port |
| `catchTag` | Error port routing through a handler box |

**Fong (2016).** "The Algebra of Open and Interconnected Systems." PhD Thesis,
Oxford. Develops "decorated cospans" for composing open systems: each has an
interface (inputs/outputs) and can be composed by connecting outputs to inputs.
The visualization of a composed system is built by composing the visualizations
of its parts.

**Fong and Spivak (2019).** *An Invitation to Applied Category Theory: Seven
Sketches in Compositionality.* Cambridge University Press. Develops wiring
diagram formalisms for composed systems with explicit interfaces. Accessible
textbook treatment.

#### Visual Languages for FP

**Reekie (1994).** "Visual Haskell: A First Attempt." Technical Report,
University of Technology Sydney. Proposed representing Haskell programs as
hierarchical dataflow graphs — functions as boxes with ports, application as
wire connection, higher-order functions as boxes containing boxes, composition
as literal wiring. Never completed, but the design is compositional,
hierarchical, and type-directed.

**Wadler (1992).** "Comprehending Monads." *Mathematical Structures in Computer
Science.* Includes "pipeline" diagrams for monadic operations showing data
flowing through filters and transformations.

**Peyton Jones and Wadler (1993).** "Imperative Functional Programming." *POPL.*
Uses "plumbing" diagrams showing how monadic bind threads state through
operations. The diagram for `a >>= f >>= g` is built by composing the diagrams
for `f` and `g`.

#### Tools

**Kissinger and Zamdzhiev (2015).** "Quantomatic: A Proof Assistant for
Diagrammatic Reasoning." *CADE.* Demonstrates that string diagrams can be
computationally manipulated — rewritten, simplified, verified. Primary use is
quantum circuits, but proves categorical diagrams can be tool-supported.

**Statebox** (https://statebox.org/) — a project using category theory (open
Petri nets, string diagrams) as a visual programming paradigm for distributed
systems. Demonstrated both the appeal and the difficulty: rigorous and
compositional, but steep learning curve.

### Effect Systems

This is the sparsest area in the literature. Very little published work exists
on visualizing effect systems specifically.

**Plotkin and Pretnar (2009/2013).** "Handlers for Algebraic Effects." *LICS /
ESOP.* The foundational paper on algebraic effects and handlers. Establishes the
operational semantics that any visualization must represent: effects are
operations, handlers intercept them, and the handler stack determines dispatch.

**Leijen (2017).** "Type Directed Compilation of Row-Typed Algebraic Effects."
*POPL.* Describes algebraic effects in Koka. Includes informal diagrams showing
how effect rows narrow as handlers are applied — `<exn, state<int>, io>` loses
`exn` after `handle_exn { ... }`. This narrowing is exactly what happens to the
`E` and `R` type parameters in Effect-TS. The closest thing to "effect system
visualization" in the academic literature.

**Brachthaeuser, Schuster, and Ostermann (2020).** "Effects as Capabilities."
*OOPSLA.* Treats effects as capabilities passed as implicit parameters
(conceptually similar to Effect-TS's `R` parameter). Suggests a visualization:
each function has required capabilities (incoming edges from providers) and
provided capabilities (outgoing edges). This is essentially a dependency
injection graph — aligning with layer dependency visualization.

**"An Introduction to Algebraic Effects and Handlers."**
https://www.eff-lang.org/handlers-tutorial.pdf
Tutorial on the Eff language. Establishes the theoretical framework that modern
effect systems (including Effect-TS) build upon.

**"Monoidal Streams for Dataflow Programming."** *arXiv:2202.02061.* Di Lavore &
de Felice. Formalizes dataflow programming using monoidal categories, connecting
to comonadic semantics.

### Program Slicing for Functional Languages

Program slicing — extracting the subset of a program relevant to a particular
value or behavior — is well-studied for imperative languages but underexplored
for effect-typed functional code.

**Weiser (1984).** "Program Slicing." *IEEE TSE.* The original paper. A slice is
the subset of a program affecting a variable's value at a particular point.
Formulated for imperative programs (control flow graphs, data dependence).

**Tip (1995).** "A Survey of Program Slicing Techniques." *Journal of
Programming Languages.* Comprehensive survey. Notes that functional programs
have simpler slicing in some ways (no aliasing, referential transparency) but
harder in others (higher-order functions, lazy evaluation).

**Biswas (1997).** "Dynamic Slicing in Higher-Order Programming Languages." PhD
Thesis, University of Pennsylvania. First treatment of slicing for higher-order
functional languages. Key challenge: functions are values, so slicing must track
function values through bindings, applications, and closures.

**Ochoa, Silva, and Vidal (2004).** "Dynamic Slicing Based on Redex Trails."
*PEPM.* Dynamic slicing for lazy functional languages using redex trails — trees
showing how each value was computed, with slices selecting relevant sub-trees.

**Reps, Horwitz, and Sagiv (1995).** "Precise Interprocedural Dataflow Analysis
via Graph Reachability." *POPL.* The IFDS/IDE framework — reduces program
analysis to graph reachability. Formulated for imperative languages but the
graph reachability approach adapts to functional settings.

**Relevance to Effect-TS:** Two unexplored slicing formulations would be
directly useful:
- **Backward slicing from a requirement:** given `R = Database | Logger`, find
  all code contributing to needing `Database` and `Logger`. Answers "why does
  this effect need these services?"
- **Forward slicing from an error:** given that `db.query()` can fail with
  `DbError`, find all code paths affected, including handlers and recovery.

Neither formulation has been published. The theoretical machinery exists
(Biswas's higher-order slicing, Reps's graph reachability) but hasn't been
applied to effect system types.

---

## Observations

### What the Literature Tells Us

1. **Edge crossings dominate readability** (Purchase 1997). Any graph layout
   should prioritize minimizing crossings above all other aesthetics.

2. **Node-link diagrams don't scale** (Ghoniem et al. 2004). They become
   unreadable around 20+ nodes. For larger structures, matrix representations,
   treemaps, or hierarchical aggregation are needed.

3. **Hierarchical layout (Sugiyama) is the right default for directed flow.**
   For execution flow (inherently directed, often acyclic), the Sugiyama layered
   approach is standard. This is what Mermaid uses internally.

4. **Progressive disclosure is essential at scale.** The focus+context and
   degree-of-interest literature consistently shows that showing everything at
   once overwhelms users. Start high-level, let users drill down.

5. **Secondary notation matters enormously** (Petre 1995). Spatial layout,
   grouping, and visual cues beyond formal syntax critically affect
   comprehension. A formally correct but poorly laid out diagram can be worse
   than text.

6. **Developers think in reachability and control flow** (LaToza and Myers 2010).
   Comprehension questions align well with execution flow diagrams — developers
   want to know what code can be reached, under what conditions, in what order.

7. **Dual views beat single views** (Banken et al. 2018). The RxFiddle work
   found that a structural graph view alongside a marble/trace view was essential
   — neither alone was sufficient. Multiple targeted diagrams beat one
   comprehensive diagram.

### Where This Project Sits

1. **No direct precedent exists** for static analysis of effect system code
   (ZIO, Cats Effect, Effect-TS, Polysemy, etc.) to produce structural flow
   diagrams. This project appears novel.

2. **The closest analogs** are Travesty (Akka Streams topology), Calligraphy
   (Haskell call graphs from HIE files), RxFiddle (RxJS pipeline visualization,
   runtime), and Flink/Spark plan visualizers.

3. **The theoretical foundations for compositional visualization exist**
   (Selinger, Fong, Spivak on string/wiring diagrams) but have not been
   translated into practical developer tooling.

4. **Effect system visualization is almost completely unexplored academically.**
   Leijen's effect-row-narrowing diagrams in the Koka papers are the closest
   precedent.

5. **Program slicing by requirement (`R`) or error channel (`E`) would be
   novel** and practically useful — the theoretical machinery exists but the
   application to effect types is unexplored.

6. **Runtime tools are abundant** across all ecosystems, but static analysis of
   effect composition is rare. Most ecosystems rely on runtime tracing.
