/** One open roadmap entry, with all it depends on, the open entries it still waits on, and what its detail card shows. */
export type RoadmapEntry = {
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
export type RoadmapBoard = { root: string; entries: RoadmapEntry[]; deferred: RoadmapEntry[]; readAt: number; mtimeMs: number; size: number }

/** The pane's sections, in the order it draws them. */
export type RoadmapSection = 'active' | 'ready' | 'blocked' | 'deferred'

/** Per section: whether it is open, and how many rows it shows. */
export type RoadmapView = Record<RoadmapSection, { isOpen: boolean; rows: number }>

declare module 'claude-code' {
  interface PluginState {
    foreman: {
      roadmapBoard: Shaped<RoadmapBoard | null>
      roadmapError: string | null
      roadmapView: RoadmapView
      /** Entries asked of Foreman from the pane, with the status each had then, until the next turn. */
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
