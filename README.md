# somegee-skills

AI 에이전트 시대의 생산성 도구 모음 by [somegee](https://github.com/somegee).

---

## AI는 어떻게 진화해왔는가

AI 코딩 도구의 역사는 곧 **"어떻게 하면 AI를 더 잘 쓸 수 있을까"** 에 대한 답을 찾아가는 과정이었다.

### 1. 좋은 모델을 쓰면 된다 — LLM 시대

초기에는 단순했다. **더 좋은 LLM을 쓰면 더 좋은 결과가 나왔다.** GPT-3에서 GPT-4로, Claude 2에서 Claude 3로 — 모델이 똑똑해질수록 코드 품질도 올라갔고, 사용자가 할 일은 그저 최신 모델을 선택하는 것뿐이었다.

하지만 모델이 아무리 좋아져도, 모호한 질문에는 모호한 답이 돌아왔다. 문제는 모델이 아니라 **질문하는 방식**에 있었다.

### 2. 프롬프트를 잘 쓰면 된다 — Prompt Engineering

그래서 **프롬프트 엔지니어링**이 등장했다. "역할을 부여하라", "단계별로 생각하게 하라", "예시를 제공하라" — 같은 모델이라도 프롬프트를 어떻게 구성하느냐에 따라 결과의 질이 극적으로 달라졌다.

프롬프트 엔지니어링은 AI 활용의 기본기가 되었지만, 근본적인 한계가 있었다. AI는 여전히 **텍스트를 주고받는 것** 이상을 할 수 없었다. 파일을 읽거나, API를 호출하거나, 코드를 실행하는 건 전부 사람의 몫이었다.

### 3. AI가 행동할 수 있게 된다 — MCP와 Agent

2024년, Anthropic이 **MCP(Model Context Protocol)** 를 발표하면서 판이 바뀌었다. MCP는 AI에게 **도구를 연결하는 표준 프로토콜**을 제공했고, 이로써 AI는 단순한 대화 상대에서 **실제로 행동하는 에이전트(Agent)** 로 진화했다.

파일 시스템을 읽고, 데이터베이스를 조회하고, 외부 API를 호출하고, 브라우저를 조작하는 것 — 모두 AI가 직접 할 수 있게 되었다. MCP 서버 하나만 연결하면 AI의 능력이 즉시 확장되는, 진정한 에이전트의 시대가 열린 것이다.

하지만 MCP에도 그림자가 있었다. 도구가 많아질수록 **컨텍스트가 비대해졌다.** 수십 개의 MCP 도구 스키마가 프롬프트에 포함되면서 토큰이 낭비되고, 정작 중요한 작업 맥락이 밀려나는 문제가 발생했다. AI에게 모든 도구를 항상 보여주는 것은 사람에게 백과사전을 펼쳐놓고 일하라는 것과 같았다.

### 4. 필요할 때만, 필요한 만큼 — Context Engineering

이 문제의 해답은 **컨텍스트 엔지니어링(Context Engineering)** 에서 나왔다. 핵심 철학은 단순하다: **AI에게 모든 것을 한 번에 주지 말고, 필요한 정보를 필요한 시점에 제공하라.**

Claude Code의 **Skills** 시스템이 대표적이다. Skills는 MCP처럼 항상 컨텍스트에 올라가 있는 게 아니라, 사용자가 호출할 때만 **점진적으로(progressively)** 로딩된다. `/terminal-swarm`이라고 입력하면 그제서야 관련 명령어와 규칙이 컨텍스트에 주입되는 식이다.

이 "점진적 공개(progressive disclosure)" 패턴 덕분에:
- 평소에는 컨텍스트가 가볍고
- 필요한 순간에만 전문 지식이 활성화되며
- 토큰 낭비 없이 깊은 전문성을 발휘할 수 있다

### 5. 혼자보다 여럿이 — Multi-Agent

에이전트가 충분히 똑똑해지자, 자연스러운 다음 단계가 등장했다. **여러 에이전트가 협업하는 멀티 에이전트(Multi-Agent)** 시스템이다.

Claude Code의 서브에이전트(Sub-agent)가 대표적인 예다. 메인 에이전트가 복잡한 작업을 분할하고, 각 서브에이전트에게 독립적인 작업을 위임한다. 리서치 에이전트가 코드베이스를 탐색하는 동안, 빌드 에이전트는 테스트를 돌리고, 리뷰 에이전트는 코드 품질을 검증한다.

효율은 극적으로 올라갔지만, **새로운 문제**가 생겼다:

- **관찰 불가**: 서브에이전트끼리 무슨 대화를 나누는지, 어떤 판단을 내렸는지 원래 쓰던 환경에서 볼 수가 없다
- **개입 불가**: 에이전트가 잘못된 방향으로 가고 있어도, 작업이 끝날 때까지 중간에 개입할 수 없다
- **컨텍스트 단절**: 각 서브에이전트는 독립된 컨텍스트에서 동작하므로, 메인 에이전트가 전체 흐름을 파악하기 어렵다

멀티 에이전트는 강력하지만, **사용자가 통제권을 잃는 순간** 오히려 생산성이 떨어지는 역설이 발생한다.

---

## Terminal Swarm — 에이전트를 관찰하고, 개입하고, 오케스트레이션하다

**Terminal Swarm**은 위의 모든 문제의식에서 출발했다.

> _멀티 에이전트의 효율성은 유지하면서, 사용자가 완전한 통제권을 갖는 환경을 만들 수 없을까?_

### 해결하는 문제

| 기존 멀티 에이전트의 문제 | Terminal Swarm의 해결 |
|:---|:---|
| 서브에이전트의 대화 내용을 볼 수 없다 | 웹 대시보드에서 **모든 세션의 터미널 출력을 실시간 스트리밍** |
| 작업 중간에 개입할 수 없다 | 언제든 **텍스트 입력, 키 전송, 파일 전송**으로 에이전트에 개입 |
| 에이전트의 상태를 알 수 없다 | Claude Code Hooks 연동으로 **작업중/완료/승인요청 상태를 시각적으로 표시** |
| 메인 에이전트가 다른 세션을 모니터링할 수 없다 | CLI를 통해 **다른 세션의 출력을 읽고, 완료를 대기하고, 결과를 수집** |

### 핵심 기능

- **Headless 터미널 관리**: 포커스 이동 없이 여러 터미널 세션을 생성/제어
- **웹 대시보드** (`localhost:7890`): 모든 세션을 한 화면에서 실시간 모니터링
- **Claude Code Hooks 연동**: 에이전트의 작업 진행/완료/권한요청 상태를 실시간 감지
  - 🟢 초록불: 작업 중 (사용자 입력 제출)
  - 🔵 파란불: 응답 완료
  - 🟡 노란불: 권한 요청 대기 + 데스크톱 알림
- **파일 트리 탐색**: CWD 기반 폴더/파일 탐색 + 에디터 + Git 상태 표시
- **Quick Launch**: 자주 쓰는 명령을 즐겨찾기로 관리
- **프리셋**: 레이아웃과 세션 배치를 슬롯별 저장/복원

### 아키텍처

```
[Daemon (localhost:7890)]
    ├── HTTP API ──→ CLI (Claude Code Bash에서 호출)
    ├── WebSocket ──→ 대시보드 실시간 스트리밍
    ├── Hooks    ──→ Claude Code 상태 수신 (Stop/PermissionRequest/UserPromptSubmit)
    └── Sessions ──→ [worker-1] [worker-2] [worker-3] ...
```

메인 Claude Code 세션이 CLI를 통해 다른 에이전트 세션을 생성하고, 명령을 전달하고, 출력을 읽고, 완료를 기다린다. 사용자는 웹 대시보드에서 이 모든 과정을 실시간으로 관찰하며 필요할 때 개입한다.

---

## Skills

| Skill | Description |
|-------|-------------|
| [terminal-swarm](./terminal-swarm/) | Agent Swarm을 위한 headless 터미널 세션 관리. 웹 대시보드에서 여러 Claude Code 에이전트를 동시에 모니터링하고 제어합니다. |

## Installation

### Via Claude Code Plugin (recommended)

```bash
/plugin marketplace add somegee/somegee-skills
/plugin install terminal-swarm@somegee-skills
```

### Manual

1. Clone this repository:
```bash
git clone https://github.com/somegee/somegee-skills.git
```

2. Copy the skill to your project:
```bash
cp -r somegee-skills/terminal-swarm/skills/terminal-swarm .claude/skills/
cp -r somegee-skills/terminal-swarm/scripts .claude/skills/terminal-swarm/
```

3. Install dependencies:
```bash
pip install pywinpty websockets winotify
```

4. Run `/terminal-swarm` in Claude Code.

## License

MIT
