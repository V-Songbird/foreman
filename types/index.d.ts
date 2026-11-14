/** One open roadmap entry, with all it depends on, the open entries it still waits on, and what its detail card shows. */
export type Entry = {
  id: string
  title: string
  status: string
  dependsOn: string[]
  waitsOn: string[]
  touches: string[]
  why: string
  createdAt: string
  source: string
}

/** What the pane draws: the project it read, its open and deferred entries, when, and the file's stat at that read. */
export type Board = { root: string; entries: Entry[]; deferred: Entry[]; readAt: number; mtimeMs: number; size: number }

/** The pane's sections, in the order it draws them. */
export type Section = 'active' | 'ready' | 'blocked' | 'deferred'

/** Per section: whether it is open, and how many rows it shows. */
export type View = Record<Section, { isOpen: boolean; rows: number }>

declare module 'claude-code' {
  interface PluginState {
    foreman: {
      roadmapBoard: Shaped<Board | null>
      roadmapError: string | null
      roadmapView: View
      /** Entries asked of Foreman from the pane, with the status each had then. */
      roadmapSent: Record<string, string>
      /** The entry whose detail card shows at the foot of the pane. */
      roadmapPicked: string | null
      /** What the search field holds: the pane lists only the entries whose id, title or reason contain it. */
      roadmapQuery: string
      /** Whether the session's project has a ROADMAP.jsonl: the footer button shows only then. */
      roadmapExists: boolean
      /** Whether the pane is open: the footer button closes it, and only an open pane reads the file. */
      roadmapOpen: boolean
    }
  }
}
