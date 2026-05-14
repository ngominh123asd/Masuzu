/**
 * FileTree — workspace file explorer with collapsible folders, file icons,
 * upload support, and preview links for HTML/images.
 */
import { useState, useCallback, useRef } from 'react'
import {
  Folder, FolderOpen, File, FileCode, FileText, FileJson,
  Image, FileType, FileVideo, FileAudio, FileArchive,
  Upload, ExternalLink,
} from 'lucide-react'
import { useAgentStore, type FileNode } from '../store/agentStore'
import s from '../agent.module.css'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/** Map file extension to lucide icon */
function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'html': case 'htm': case 'jsx': case 'tsx': case 'vue':
      return <FileCode size={13} color="var(--amber)" />
    case 'css': case 'scss': case 'less':
      return <FileCode size={13} color="#56b6c2" />
    case 'js': case 'ts': case 'mjs':
      return <FileCode size={13} color="#e5c07b" />
    case 'py': case 'rb': case 'go': case 'rs': case 'java': case 'c': case 'cpp':
      return <FileCode size={13} color="var(--green)" />
    case 'json': case 'yaml': case 'yml': case 'toml':
      return <FileJson size={13} color="#d19a66" />
    case 'md': case 'txt': case 'log': case 'csv':
      return <FileText size={13} color="var(--phos-mute)" />
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp': case 'ico':
      return <Image size={13} color="#c678dd" />
    case 'mp4': case 'webm': case 'mov':
      return <FileVideo size={13} color="#e06c75" />
    case 'mp3': case 'wav': case 'ogg':
      return <FileAudio size={13} color="#e06c75" />
    case 'zip': case 'tar': case 'gz': case '7z': case 'rar':
      return <FileArchive size={13} color="var(--phos-mute)" />
    case 'woff': case 'woff2': case 'ttf': case 'otf': case 'eot':
      return <FileType size={13} color="var(--phos-mute)" />
    default:
      return <File size={13} color="var(--phos-mute)" />
  }
}

/** Check if a file can be previewed in the right-side panel */
function isTextPreviewable(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return ['md','txt','log','csv','json','yaml','yml','toml','html','htm','css','scss',
    'js','ts','jsx','tsx','py','rb','go','rs','java','c','cpp','h','sh','sql','xml',
    'env','cfg','ini','conf','vue','svelte','astro','mjs','cjs'].includes(ext)
}

/** Check if a file can be previewed in browser (HTML/images) */
function isPreviewable(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return ['html', 'htm', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'pdf'].includes(ext)
}

/** Build a nested tree structure from flat file list */
interface TreeNode {
  name: string
  path: string
  is_dir: boolean
  size: number
  children: TreeNode[]
}

function buildTree(files: FileNode[]): TreeNode[] {
  const root: TreeNode[] = []
  const nodeMap = new Map<string, TreeNode>()

  // Helper to ensure parent path exists in nodeMap
  function ensureParent(path: string): TreeNode | null {
    if (!path || path === '') return null
    
    if (nodeMap.has(path)) {
      return nodeMap.get(path)!
    }

    // Parent doesn't exist yet, create it recursively
    const parts = path.split('/')
    const name = parts[parts.length - 1]
    const parentPath = parts.slice(0, -1).join('/')
    
    const node: TreeNode = {
      name: name,
      path: path,
      is_dir: true,
      size: 0,
      children: [],
    }
    nodeMap.set(path, node)

    // Link to its parent
    const parent = ensureParent(parentPath)
    if (parent) {
      parent.children.push(node)
    } else {
      root.push(node)
    }

    return node
  }

  const sorted = [...files].sort((a, b) => {
    if (a.is_dir && !b.is_dir) return -1
    if (!a.is_dir && b.is_dir) return 1
    return a.name.localeCompare(b.name)
  })

  for (const file of sorted) {
    // Skip if already in map (shouldn't happen but safety check)
    if (nodeMap.has(file.path)) continue

    const node: TreeNode = {
      name: file.name,
      path: file.path,
      is_dir: file.is_dir,
      size: file.size,
      children: [],
    }
    nodeMap.set(file.path, node)

    const parts = file.path.split('/')
    parts.pop()
    const parentPath = parts.join('/')

    // Ensure parent exists
    const parent = ensureParent(parentPath)
    if (parent) {
      parent.children.push(node)
    } else if (parentPath === '') {
      // Root level file
      root.push(node)
    }
  }

  function sortChildren(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.is_dir && !b.is_dir) return -1
      if (!a.is_dir && b.is_dir) return 1
      return a.name.localeCompare(b.name)
    })
    for (const n of nodes) {
      if (n.children.length > 0) sortChildren(n.children)
    }
  }
  sortChildren(root)
  return root
}

function TreeItem({ node, depth, expanded, onToggle, sessionId }: {
  node: TreeNode
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
  sessionId: string
}) {
  const isOpen = expanded.has(node.path)
  const { openPreview } = useAgentStore()

  const handleFileClick = async () => {
    if (node.is_dir) return
    if (!isTextPreviewable(node.name)) return
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/files/${node.path}`)
      if (res.ok) {
        const data = await res.json()
        openPreview(node.path, data.content || '', node.name)
      }
    } catch (e) {
      console.error('Failed to fetch file:', e)
    }
  }

  if (node.is_dir) {
    return (
      <>
        <div
          className={`${s.fileItem} ${s.fileItemDir}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => onToggle(node.path)}
        >
          <span className={s.fileItemIcon}>
            {isOpen
              ? <FolderOpen size={14} color="var(--amber)" />
              : <Folder size={14} color="var(--amber)" />
            }
          </span>
          <span className={s.fileItemName}>{node.name}</span>
          <span className={s.fileItemChevron}>{isOpen ? '▾' : '▸'}</span>
        </div>
        {isOpen && node.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            sessionId={sessionId}
          />
        ))}
      </>
    )
  }

  const canPreview = isTextPreviewable(node.name)

  return (
    <div
      className={`${s.fileItem} ${canPreview ? s.fileItemClickable : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={canPreview ? handleFileClick : undefined}
    >
      <span className={s.fileItemIcon}>{getFileIcon(node.name)}</span>
      <span className={s.fileItemName}>{node.name}</span>
      {isPreviewable(node.name) && (
        <a
          className={s.filePreviewLink}
          href={`${API_BASE}/preview/${sessionId}/${node.path}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Preview in browser"
        >
          <ExternalLink size={10} />
        </a>
      )}
      {node.size > 0 && (
        <span className={s.fileItemSize}>{formatSize(node.size)}</span>
      )}
    </div>
  )
}

export function FileTree() {
  const { files, activeSessionId, fileTreeExpanded, setFileTreeExpanded } = useAgentStore()
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const toggleDir = useCallback((path: string) => {
    const next = new Set(fileTreeExpanded)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setFileTreeExpanded(next)
  }, [fileTreeExpanded, setFileTreeExpanded])

  const handleUpload = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !activeSessionId) return
    setUploading(true)
    try {
      for (const file of Array.from(fileList)) {
        const form = new FormData()
        form.append('file', file)
        form.append('directory', '')
        await fetch(`${API_BASE}/api/sessions/${activeSessionId}/upload`, {
          method: 'POST',
          body: form,
        })
      }
      // Refresh file list
      const res = await fetch(`${API_BASE}/api/sessions/${activeSessionId}/files`)
      const data = await res.json()
      useAgentStore.getState().setFiles(data)
    } catch (e) {
      console.error('Upload failed:', e)
    } finally {
      setUploading(false)
      // Reset input so same file can be re-uploaded
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [activeSessionId])

  if (!activeSessionId) {
    return (
      <div className={s.mute} style={{ fontSize: 11, padding: '8px 0' }}>
        No files in workspace
      </div>
    )
  }

  const tree = buildTree(files)

  return (
    <div className={s.fileTree}>
      {/* Upload button */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleUpload(e.target.files)}
      />
      <button
        className={s.fileUploadBtn}
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        <Upload size={12} />
        {uploading ? 'UPLOADING...' : 'UPLOAD FILE'}
      </button>

      {files.length === 0 ? (
        <div className={s.mute} style={{ fontSize: 11, padding: '8px 0' }}>
          No files in workspace
        </div>
      ) : (
        tree.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            depth={0}
            expanded={fileTreeExpanded}
            onToggle={toggleDir}
            sessionId={activeSessionId}
          />
        ))
      )}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${(bytes / 1024 / 1024).toFixed(1)}M`
}
