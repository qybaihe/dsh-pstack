/**
 * Read a poteto-mode playbook into steps. poteto-mode tells the agent to
 * "copy its steps into the todolist tool first", so the plugin seeds the todo
 * list and the progress rail from the same parse.
 *
 * A playbook is a `### Title`, a stance line that usually leads in bold, its
 * steps, and a `**Reply:**` paragraph. The steps are a numbered list, a bullet
 * list in the playbooks that are rule lists, or plain paragraphs.
 */

export interface PlaybookStep {
  readonly index: number
  /** The step as written, continuation lines joined with newlines. */
  readonly text: string
  /** A label short enough for one row of a progress rail. */
  readonly label: string
  /** pstack skills the step names, in the order they appear. */
  readonly routes: readonly string[]
}

export interface Playbook {
  readonly title: string
  readonly stance: string
  readonly steps: readonly PlaybookStep[]
  readonly reply: string
}

const NUMBERED = /^\d+\. +(.*)$/
const BULLETED = /^- +(.*)$/
const LABEL_LIMIT = 72

/** `Bug fix` becomes `bug-fix`, the playbook's file name. */
export function playbookSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function labelOf(text: string): string {
  const firstLine = (text.split('\n', 1)[0] as string).replace(/\*\*/g, '').replace(/`/g, '')
  const sentence = (/^(.+?[.!?])(\s|$)/.exec(firstLine)?.[1] ?? firstLine).trim()
  if (sentence.length <= LABEL_LIMIT) return sentence.replace(/[.:]$/, '')
  return `${sentence.slice(0, LABEL_LIMIT - 1).trimEnd()}…`
}

/** The bold lead of the line under the title, or the whole line when none is bold. */
function stanceOf(line: string): string {
  const bold = /^\*\*(.+?)\*\*/.exec(line)
  return (bold === null ? line : (bold[1] as string)).trim()
}

function routesOf(text: string, knownSkills: ReadonlySet<string>): string[] {
  const routes: string[] = []
  for (const match of text.matchAll(/\*\*([a-z0-9-]+)\*\*|`\/?([a-z0-9-]+)`/g)) {
    const written = match[1] ?? match[2]
    if (written === undefined) continue
    // Playbooks name a principle without its prefix: "the **prove-it-works** principle skill".
    const name = knownSkills.has(written) ? written : `principle-${written}`
    if (knownSkills.has(name) && !routes.includes(name)) routes.push(name)
  }
  return routes
}

export function parsePlaybook(markdown: string, knownSkills: ReadonlySet<string> = new Set()): Playbook | undefined {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const titleLine = lines.find((line) => line.startsWith('### '))
  if (titleLine === undefined) return undefined

  const numbered = lines.some((line) => NUMBERED.test(line))
  const item = numbered ? NUMBERED : BULLETED
  const chunks: string[][] = []
  const paragraphs: string[] = []
  let stance = ''
  let reply = ''
  let open: string[] | undefined

  for (const line of lines) {
    const start = item.exec(line)
    if (start !== null) {
      open = [start[1] as string]
      chunks.push(open)
    } else if (open !== undefined && /^\s+\S/.test(line)) {
      open.push(line.trim())
    } else if (line.trim() !== '') {
      open = undefined
      if (line.startsWith('**Reply:**')) reply = line.slice('**Reply:**'.length).trim()
      else if (line === titleLine) continue
      else if (stance === '' && chunks.length === 0) stance = stanceOf(line)
      else paragraphs.push(line)
    }
  }
  // A playbook written as prose, such as Opening a PR, has one step per paragraph.
  if (chunks.length === 0) chunks.push(...paragraphs.map((paragraph) => [paragraph]))

  return {
    title: titleLine.slice(4).trim(),
    stance,
    steps: chunks.map((chunk, i) => {
      const text = chunk.join('\n')
      return { index: i + 1, text, label: labelOf(text), routes: routesOf(text, knownSkills) }
    }),
    reply,
  }
}
