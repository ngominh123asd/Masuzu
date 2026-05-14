/**
 * TerminalOutput — monospace streaming terminal display.
 * Dark background, ANSI color support, copy button.
 */
import { useRef, useEffect, useState, useCallback } from 'react'
import s from '../agent.module.css'

interface Props {
  content: string
}

export function TerminalOutput({ content }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  // Auto-scroll to bottom
  useEffect(() => {
    const el = containerRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [content])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [content])

  return (
    <div className={s.terminalBox} ref={containerRef} style={{ position: 'relative' }}>
      <button className={s.terminalCopyBtn} onClick={handleCopy}>
        {copied ? 'COPIED' : 'COPY'}
      </button>
      <div
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    </div>
  )
}
