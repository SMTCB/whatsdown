# Technical & Functional Blueprint: Project-Agnostic Agentic Maintenance Platform

This document outlines a production-grade, project-agnostic agentic system designed to handle issue ingestion, technical root-cause analysis, automated code patch generation, quality assurance validation, and user/stakeholder feedback.

---

## 1. Industry Standard Agent Hierarchy

Rather than a simple linear assembly line, industry best practices utilize a **Router/Supervisor Architecture** featuring dual human-in-the-loop (HITL) checkpoints. This prevents hallucinatory code loops, limits token waste, and keeps human oversight over critical production operations.

```
                  ┌──────────────────────────────┐
                  │   Trigger / Ingress Layer    │
                  │  (WhatsApp, Discord, Slack)  │
                  └──────────────┬───────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │    Agent 1: Triage & Route   │
                  └──────────────┬───────────────┘
                                 │
                        [Structured Ticket]
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │  Agent 2: Tech Diagnostics   │
                  └──────────────┬───────────────┘
                                 │
                     [Root Cause & Patch Plan]
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │   Human Oversight (HITL #1)  │
                  │ (Approval to attempt fix)   │
                  └──────────────┬───────────────┘
                                 │
                             [Approved]
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │   Agent 3: Code Developer    │
                  └──────────────┬───────────────┘
                                 │
                             [Draft PR]
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │     Agent 4: QA & Tester     │
                  └──────────────┬───────────────┘
                                 │
                       [Test Matrix Output]
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │   Human Oversight (HITL #2)  │
                  │   (PR Review & Merge Trigger)│
                  └──────────────┬───────────────┘
                                 │
                             [Merged]
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │  Agent 5: Comm & Dispatcher   │
                  └──────────────┴───────────────┘
```

---

## 2. Functional & Agent Matrix

| Agent | Functional Role | Model Tier Strategy | Primary MCPs & Tools | Input / Output |
| :--- | :--- | :--- | :--- | :--- |
| **Agent 1: Triage & Classifier** | • Deduplicates issues<br>• Extracts metadata (User, Environment)<br>• Rejects out-of-scope/invalid inputs | **Fast / Low-Cost Model**<br>*(e.g., Claude 3.5 Haiku, GPT-4o-mini)* | • Webhook Receiver<br>• Memory/Database Vector Search (to detect duplicate tickets) | **In:** Raw chat message / template<br>**Out:** Normalized JSON Ticket Spec |
| **Agent 2: Technical Diagnostics** | • Navigates project codebase<br>• Traces log files/error traces<br>• Drafts technical root-cause analysis & resolution plan | **Reasoning / Heavy Model**<br>*(e.g., Claude 3.7 Sonnet, DeepSeek-R1)* | • GitHub MCP (File search, directory tree)<br>• Code AST Indexer (Greptile/Sourcegraph API)<br>• Log Monitoring API | **In:** Normalized Ticket Spec<br>**Out:** Diagnostic Markdown + Proposed Fix Strategy |
| **Agent 3: Automated Developer** | • Creates feature branch<br>• Edits targeted code files<br>• Submits Pull Request | **Coding / Heavy Model**<br>*(e.g., Claude 3.7 Sonnet, GPT-4o)* | • GitHub MCP (Create branch, file updates, open PR)<br>• Workspace/Sandbox CLI | **In:** Diagnostic Fix Strategy<br>**Out:** GitHub Pull Request Link |
| **Agent 4: QA & Testing Verification** | • Executes test suite<br>• Spins up ephemeral runner<br>• Analyzes test coverage and diff regression | **Deterministic Code Runner + Medium LLM**<br>*(e.g., Claude 3.5 Haiku / Sonnet)* | • E2B / Modal Docker Sandbox MCP<br>• GitHub MCP (Comment on PR) | **In:** PR Branch<br>**Out:** Pass/Fail Test Matrix & Logs |
| **Agent 5: Stakeholder Communicator** | • Translates dev summary into user-friendly message<br>• Posts thread update to original channel | **Fast / Low-Cost Model**<br>*(e.g., GPT-4o-mini, Claude 3.5 Haiku)* | • Messaging API (WhatsApp Bridge / Slack Webhook)<br>• Database Status Updater | **In:** Merged PR status + User Context<br>**Out:** Final User-Facing Message |

---

## 3. Agent Persona & Duty Specifications

To ensure predictable behavior across different platforms, each agent operates with a strict persona, system prompt instructions, and clear guardrails.

### Agent 1: Triage & Intake Dispatcher (`Sentry`)
* **Role/Persona:** Strict, analytical support desk dispatcher. Unemotional, hyper-focused on data accuracy, format compliance, and rapid filtering.
* **Core Job:** 
  1. Ingest raw webhooks (WhatsApp/Discord/Form).
  2. Parse template structures and strip irrelevant conversational fluff.
  3. Query database/vector search for existing duplicate issues.
  4. Output a clean, structured JSON ticket payload containing `ticket_id`, `environment`, `reproduction_steps`, and `severity`.
* **Guardrails:** Never attempts to answer technical questions or give code advice. If incoming data is unformatted, responds immediately requesting missing template fields.

### Agent 2: Technical Diagnostics Lead (`Architect`)
* **Role/Persona:** Senior Principal Software Architect and Debugging Specialist. Rigorous, methodical, cautious, and deeply knowledgeable about software patterns and AST graphs.
* **Core Job:**
  1. Receive JSON ticket specs.
  2. Use GitHub search MCP / AST indexing tools to map the issue to specific repo files, schemas, or API endpoints.
  3. Analyze logs and stack traces.
  4. Write a **Diagnostic Markdown Specification** containing: identified root cause, exact file paths target, proposed logical fix, and regression risks.
* **Guardrails:** Does **not** write production code edits or execute Git commits. Focuses purely on analysis to prevent premature code modifications.

### Agent 3: Patch Automation Developer (`Coder`)
* **Role/Persona:** Senior Software Engineer. Precise, pragmatic, and strictly adheres to existing repository conventions, linting rules, and style guides.
* **Core Job:**
  1. Read the approved Diagnostic Specification from Agent 2.
  2. Create a isolated git branch (`fix/ticket-[ID]`).
  3. Modify target files using GitHub file update APIs or a dynamic workspace runner.
  4. Open a Pull Request referencing the issue ID with a summary of changes.
* **Guardrails:** Edits **only** the target files specified by Agent 2. Forbidden from changing project configurations or dependencies unless explicitly authorized.

### Agent 4: Quality Assurance Engine (`Inspector`)
* **Role/Persona:** Ruthless QA Automation Engineer. Skeptical, thorough, and hyper-vigilant about regressions, failing tests, and edge-case coverage.
* **Core Job:**
  1. Checkout the PR branch opened by Agent 3 in an ephemeral Docker environment (e.g., E2B / Modal).
  2. Run the platform's test suite (`npm test`, `pytest`).
  3. Verify that new code passes while maintaining backwards compatibility.
  4. Post a formatted Test Execution Matrix comment directly onto the GitHub PR.
* **Guardrails:** If tests fail, flags the PR as `FAILED` and passes logs back to Agent 3 for a maximum of 2 auto-retry loops before alerting a human.

### Agent 5: Stakeholder Communicator (`Relay`)
* **Role/Persona:** Friendly, empathetic Customer Support Representative and Product Specialist. Clear, encouraging, jargon-free, and professional.
* **Core Job:**
  1. Listen for PR merge events.
  2. Translate Agent 2's diagnostic findings and Agent 3's fix summary into clear, non-technical human language.
  3. Post updates directly to the original messaging thread (WhatsApp, Slack, or email).
* **Guardrails:** Never exposes internal server paths, database credentials, or complex code diffs to end users.

---

## 4. End-to-End System Architecture Diagram

```
                 COMMUNICATION LAYER
 ┌───────────────────────────────────────────────────┐
 │ WhatsApp (Evolution API) / Discord / Slack / Web  │
 └─────────┬─────────────────────────────────────────┘
           │ Webhook Ingest
           ▼
  ORCHESTRATION ENGINE
 ┌───────────────────────────────────────────────────┐
 │ LangGraph / Mastra / CrewAI Runtime               │
 │                                                   │
 │ ┌───────────┐     ┌───────────┐     ┌───────────┐ │
 │ │ Agent 1   ├────►│ Agent 2   ├────►│ Agent 3   │ │
 │ │ Triage    │     │ Diagnostics│     │ Developer │ │
 │ └───────────┘     └───────────┘     └─────┬─────┘ │
 │                                           │       │
 │ ┌───────────┐                       ┌─────▼─────┐ │
 │ │ Agent 5   │◄──────────────────────┤ Agent 4   │ │
 │ │ Comms     │                       │ QA Tester │ │
 │ └───────────┘                       └───────────┘ │
 └──────┬──────────────────┬──────────────────┬──────┘
        │                  │                  │
        │ MCP Protocol     │ MCP Protocol     │ API Execution
        ▼                  ▼                  ▼
  MCP TOOLS LAYER    KNOWLEDGE LAYER    EXECUTION LAYER
 ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
 │ GitHub MCP    │  │ Code AST      │  │ Ephemeral     │
 │ Server        │  │ Embeddings    │  │ Docker Engine │
 │               │  │ (Greptile/    │  │ (Modal /      │
 │ Postgres MCP  │  │ ChromaDB)     │  │ E2B Sandbox)  │
 └───────────────┘  └───────────────┘  └───────────────┘
```

---

## 5. Technical Stack Strategy

To ensure this architecture remains project-agnostic, keep the platform separated from the software it maintains.

### Core Component Breakdown

1. **Orchestration Framework:**
   * **TypeScript Option:** **Mastra** or **LangGraph.js** (Best if you build apps in Node/TS).
   * **Python Option:** **LangGraph (Python)** or **CrewAI** (Best if you lean toward data science pipelines).
   * *Recommendation:* **LangGraph** (either language) because graph-based state management natively handles retries, human approvals, and conditional loops.

2. **Model Context Protocol (MCP) Tools:**
   * **GitHub MCP Server:** Standardized protocol handling file operations, PR creation, and issue management.
   * **Postgres / DB MCP Server:** Provides schema inspection capabilities without granting raw write privileges.
   * **Code Search MCP:** Connects to indexed code graphs so agents can fetch only contextually relevant files.

3. **Execution & Isolation Environment:**
   * **E2B (Explicit Environment for Code Interpreters) or Modal:** Secure, ephemeral cloud sandboxes created on demand to run tests, execute code fixes, and safely run `npm test` or `pytest`.

4. **Persistence & Observability:**
   * **State & Audit Database:** PostgreSQL or Supabase (Tracks ticket state, history logs, human approvals).
   * **Observability:** **LangSmith** or **Arize Phoenix** (Traces prompts, agent decisions, and token consumption).

---

## 6. Cost & Efficiency Blueprint

To make this architecture affordable, pair high-reasoning models with fast, low-cost options based on the specific requirements of each step:

```
[Incoming Ticket] 
        │
        ├──► Agent 1 (Fast Model: $0.0001/run) ──► Standard JSON
        │
        ├──► Agent 2 (Reasoning Model: $0.015/run) ──► Plan & File Targets
        │
        ├──► Agent 3 (Coding Model: $0.030/run) ──► Draft Diff
        │
        ├──► Agent 4 (Local Sandbox + Fast Model: $0.001/run) ──► Test Results
        │
        └──► Agent 5 (Fast Model: $0.0001/run) ──► User Response
```

* **Cost Reduction Strategy:** ~80% of execution time is spent on triage, search, test execution, and notification delivery. Reserve high-end models (such as Claude 3.7 Sonnet or GPT-4o) exclusively for Agent 2 (Diagnostics) and Agent 3 (Code Authoring).

---

## 7. CrewAI Native Implementation Guide

CrewAI natively allows configurations using standard Python declarations or decoupled `YAML` files (`agents.yaml` and `tasks.yaml`). Below is the complete configuration code for implementing this 5-agent maintenance pipeline.

### Configuration Files

#### `config/agents.yaml`
```yaml
triage_agent:
  role: >
    Support Ticket Classifier & Intake Dispatcher
  goal: >
    Ingest raw incoming support messages, strip conversational fluff, extract target repository metadata, and produce a structured JSON ticket payload.
  backstory: >
    You are Sentry, a strict and unemotional automated support desk dispatcher. Your sole focus is data accuracy, format compliance, and fast issue normalization. You never give technical advice or attempt code fixes yourself.

diagnostic_agent:
  role: >
    Technical Diagnostics Lead & Architect
  goal: >
    Navigate the project codebase, trace errors, inspect logs/schemas, and produce a clear Markdown Root-Cause Analysis (RCA) and Patch Plan.
  backstory: >
    You are Architect, a Principal Debugging Specialist. You possess deep knowledge of AST representations and software design patterns. You read code cautiously and produce meticulous diagnostic specs without making premature code changes.

developer_agent:
  role: >
    Automated Patch Engineer
  goal: >
    Execute the approved Patch Plan by creating a git branch, modifying target repository files, and submitting a Pull Request.
  backstory: >
    You are Coder, a pragmatic Senior Software Engineer. You write clean, modular, and maintainable code that strictly adheres to the existing repository's styling and conventions.

qa_agent:
  role: >
    Quality Assurance & Test Engineer
  goal: >
    Verify proposed Pull Requests by running unit and integration tests inside an isolated sandbox, ensuring zero regressions.
  backstory: >
    You are Inspector, a hyper-vigilant QA Automation Specialist. You are skeptical of all code diffs and strictly validate that tests pass and edge cases are handled before approving code changes.

communicator_agent:
  role: >
    Stakeholder & Customer Support Communicator
  goal: >
    Translate technical resolutions into clear, empathetic, user-friendly language and send final notifications to the original user channel.
  backstory: >
    You are Relay, a friendly and professional customer support representative. You excel at communicating technical updates in simple, jargon-free human language without leaking sensitive system details.
```

#### `config/tasks.yaml`
```yaml
triage_task:
  description: >
    Parse the raw incoming user report: "{raw_message}".
    Extract: issue category, target repository ({repo_name}), user ID, environment, and reproduction steps.
  expected_output: >
    A JSON object containing: ticket_id, repo_name, environment, severity, and normalized_description.
  agent: triage_agent

diagnostic_task:
  description: >
    Review the structured ticket output from triage_task.
    Use codebase inspection tools to search the repository "{repo_name}" for relevant files, functions, and error logs.
    Locate the root cause and write a Diagnostic Specification.
  expected_output: >
    A Markdown document specifying: Root Cause, Target Files to Edit, Proposed Logical Fix, and Regression Risks.
  agent: diagnostic_agent

build_task:
  description: >
    Take the Diagnostic Specification from diagnostic_task.
    Create a new git branch 'fix/{ticket_id}', apply the required code edits to "{repo_name}", and open a GitHub Pull Request.
  expected_output: >
    A string containing the Pull Request URL and a summary of modified files.
  agent: developer_agent

qa_task:
  description: >
    Checkout the Pull Request branch created in build_task.
    Execute the test suite in an ephemeral sandbox environment and verify that no regressions occur.
  expected_output: >
    A Test Matrix output (PASS/FAIL), test execution logs, and confirmation of PR comment status.
  agent: qa_agent

communication_task:
  description: >
    Review the final status of build_task and qa_task.
    Translate the fix details into an empathetic update for the end user and deliver it to the original channel.
  expected_output: >
    A user-friendly message ready for WhatsApp/Slack transmission.
  agent: communicator_agent
```

---

### Python Crew Pipeline (`main.py`)

Below is the execution pipeline combining model tiering, custom GitHub tools, and task flow control:

```python
import os
from crewai import Agent, Crew, Process, Task, LLM
from crewai.tools import tool
from pydantic import BaseModel, Field

# -------------------------------------------------------------------
# 1. LLM Model Configurations (Cost-Optimized Strategy)
# -------------------------------------------------------------------
# Fast/Low-Cost Model for Triage and Communication Tasks
fast_llm = LLM(
    model="gpt-4o-mini",
    temperature=0.1
)

# Reasoning/Heavy Model for Root-Cause Analysis and Code Generation
reasoning_llm = LLM(
    model="anthropic/claude-3-7-sonnet-20250219",
    temperature=0.2
)

# -------------------------------------------------------------------
# 2. Custom Tools Definition (e.g., GitHub & Messaging Operations)
# -------------------------------------------------------------------
class RepoSearchInput(BaseModel):
    repo_name: str = Field(description="Target repository name, e.g., 'owner/fantasy-app'")
    query: str = Field(description="Search term or error log phrase")

@tool("GitHub Code Search Tool", args_schema=RepoSearchInput)
def search_github_code(repo_name: str, query: str) -> str:
    """Searches a target GitHub repository for matching file contents or function definitions."""
    # Production implementation hooks into GitHub REST API or GitHub MCP server
    return f"[Mock API Result] Found matching instances of '{query}' in file: src/services/scoring.ts"

class CreatePRInput(BaseModel):
    repo_name: str = Field(description="Target repository name")
    branch_name: str = Field(description="Branch name for fix, e.g., 'fix/TICK-101'")
    file_path: str = Field(description="Path to target file")
    file_content: str = Field(description="Updated raw file content")

@tool("GitHub PR Creator Tool", args_schema=CreatePRInput)
def create_github_pr(repo_name: str, branch_name: str, file_path: str, file_content: str) -> str:
    """Creates a new git branch, updates target file, and opens a Pull Request on GitHub."""
    return f"Successfully opened PR on {repo_name} from branch {branch_name}. URL: https://github.com/{repo_name}/pull/42"

# -------------------------------------------------------------------
# 3. Agent Declarations
# -------------------------------------------------------------------
agent_triage = Agent(
    config="config/agents.yaml",
    role="Support Ticket Classifier & Intake Dispatcher",
    llm=fast_llm,
    verbose=True
)

agent_diagnostic = Agent(
    config="config/agents.yaml",
    role="Technical Diagnostics Lead & Architect",
    llm=reasoning_llm,
    tools=[search_github_code],
    verbose=True
)

agent_developer = Agent(
    config="config/agents.yaml",
    role="Automated Patch Engineer",
    llm=reasoning_llm,
    tools=[create_github_pr],
    verbose=True
)

agent_qa = Agent(
    config="config/agents.yaml",
    role="Quality Assurance & Test Engineer",
    llm=fast_llm,
    verbose=True
)

agent_communicator = Agent(
    config="config/agents.yaml",
    role="Stakeholder & Customer Support Communicator",
    llm=fast_llm,
    verbose=True
)

# -------------------------------------------------------------------
# 4. Task Declarations with Human-In-The-Loop Approval Steps
# -------------------------------------------------------------------
task_1_triage = Task(
    config="config/tasks.yaml",
    task_name="triage_task",
    agent=agent_triage
)

task_2_diagnostic = Task(
    config="config/tasks.yaml",
    task_name="diagnostic_task",
    agent=agent_diagnostic,
    # HITL Checkpoint #1: Require human confirmation before proceeding to code generation
    human_input=True 
)

task_3_build = Task(
    config="config/tasks.yaml",
    task_name="build_task",
    agent=agent_developer
)

task_4_qa = Task(
    config="config/tasks.yaml",
    task_name="qa_task",
    agent=agent_qa,
    # HITL Checkpoint #2: Require human approval on PR diff & tests before sending customer comms
    human_input=True
)

task_5_communication = Task(
    config="config/tasks.yaml",
    task_name="communication_task",
    agent=agent_communicator
)

# -------------------------------------------------------------------
# 5. Crew Orchestration Execution
# -------------------------------------------------------------------
maintenance_crew = Crew(
    agents=[agent_triage, agent_diagnostic, agent_developer, agent_qa, agent_communicator],
    tasks=[task_1_triage, task_2_diagnostic, task_3_build, task_4_qa, task_5_communication],
    process=Process.sequential,
    verbose=True
)

if __name__ == "__main__":
    # Example incoming payload from WhatsApp Webhook
    sample_input = {
        "raw_message": "#ticket Lineup lock timed out during Sunday's matches. Bench points were lost.",
        "repo_name": "my-org/fantasy-sports-backend"
    }
    
    # Run crew workflow
    result = maintenance_crew.kickoff(inputs=sample_input)
    print("\n--- Pipeline Result Output ---")
    print(result)
```