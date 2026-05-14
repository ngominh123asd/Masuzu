/**
 * FilePreviewPanel — Right-side slide-in panel to preview files
 * created/edited by the agent. Supports markdown rendering and
 * syntax-highlighted code display with line numbers.
 */
import { useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAgentStore } from '../store/agentStore'
import s from '../agent.module.css'

/** Render code with line numbers */
function CodeWithLineNumbers({ content, startLine = 1 }: { content: string; startLine?: number }) {
  const lines = useMemo(() => content.split('\n'), [content])
  return (
    <div className={s.codeWithLineNumbers}>
      <div className={s.codeLineNumbers}>
        {lines.map((_, i) => (
          <div key={i} className={s.codeLine}>{startLine + i}</div>
        ))}
      </div>
      <pre className={s.filePreviewCode}>
        <code>{content}</code>
      </pre>
    </div>
  )
}

/** Detect language from file extension for display */
function getLang(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const MAP: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX',
    py: 'Python', md: 'Markdown', json: 'JSON', html: 'HTML',
    css: 'CSS', yaml: 'YAML', yml: 'YAML', sh: 'Shell',
    sql: 'SQL', toml: 'TOML', txt: 'Text', rs: 'Rust',
    go: 'Go', java: 'Java', rb: 'Ruby', php: 'PHP',
  }
  return MAP[ext] || ext.toUpperCase() || 'FILE'
}

export function FilePreviewPanel() {
  const { previewFile, closePreview } = useAgentStore()

  const handleCopy = useCallback(() => {
    if (previewFile) {
      navigator.clipboard.writeText(previewFile.content)
    }
  }, [previewFile])

  if (!previewFile) return null

  const isMarkdown = previewFile.name.endsWith('.md')
  const lang = getLang(previewFile.name)

  return (
    <div className={s.filePreviewOverlay} onClick={closePreview}>
      <div className={s.filePreviewPanel} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={s.filePreviewHeader}>
          <div className={s.filePreviewTitle}>
            <span className={s.filePreviewIcon}>◆</span>
            <span className={s.filePreviewName}>{previewFile.name}</span>
            <span className={s.filePreviewLang}>{lang}</span>
          </div>
          <div className={s.filePreviewActions}>
            <button className={s.filePreviewBtn} onClick={handleCopy}>COPY</button>
            <button className={s.filePreviewBtn} onClick={closePreview}>✕</button>
          </div>
        </div>

        {/* Path */}
        <div className={s.filePreviewPath}>{previewFile.path}</div>

        {/* Content */}
        <div className={s.filePreviewContent}>
          {isMarkdown ? (
            <div className={s.filePreviewMarkdown}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {previewFile.content}
              </ReactMarkdown>
            </div>
          ) : (
            <CodeWithLineNumbers content={previewFile.content} />
          )}
        </div>
      </div>
    </div>
  )
}
