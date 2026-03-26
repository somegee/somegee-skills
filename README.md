# somegee-skills

Collection of Claude Code skills by [somegee](https://github.com/somegee).

## Skills

| Skill | Description |
|-------|-------------|
| [terminal-swarm](./terminal-swarm/) | Agent Swarm을 위한 headless 터미널 세션 관리. 웹 대시보드에서 여러 Claude Code 에이전트를 동시에 모니터링하고 제어합니다. |

## Installation

### terminal-swarm

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
