import {
  EXPLORATION_ALARM_ROOM,
  EXPLORATION_ARCHIVE_ROOM,
  EXPLORATION_ENTRANCE,
  EXPLORATION_EXIT_ROOM,
  EXPLORATION_STORE_ROOM,
  emptyExplorationState,
  projectPublicExploration,
  type ExplorationState,
} from "@/lib/trpg/explorationMap";
import type { ExplorationCommand, PublicExploration } from "@/lib/trpg/explorationPublic";
import PreviewFrame from "./PreviewFrame";

export const dynamic = "force-dynamic";

type Shot = "collapsed" | "unexplored" | "discovered" | "queued" | "short";

function shotOf(raw: string | undefined): Shot {
  switch (raw) {
    case "collapsed":
    case "unexplored":
    case "discovered":
    case "queued":
    case "short":
      return raw;
    default:
      return "collapsed";
  }
}

function project(state: ExplorationState, location: string, roundNumber: number): PublicExploration {
  const projected = projectPublicExploration({
    state,
    viewerParticipantId: 1,
    viewerLocation: location,
    roundNumber,
  });
  if (!projected) throw new Error("preview projection missing");
  return projected;
}

const PREVIEW_SEED = "fork-visible";

function unexplored(): PublicExploration {
  return project(emptyExplorationState(PREVIEW_SEED), EXPLORATION_ENTRANCE, 1);
}

function discovered(): PublicExploration {
  const state = emptyExplorationState(PREVIEW_SEED);
  return project(
    {
      ...state,
      visitedRoomIds: [
        EXPLORATION_ENTRANCE,
        "중앙홀",
        "북쪽복도",
        EXPLORATION_ARCHIVE_ROOM,
        "남쪽복도",
        EXPLORATION_STORE_ROOM,
        EXPLORATION_ALARM_ROOM,
        EXPLORATION_EXIT_ROOM,
      ],
      revealedEventIds: ["event-clue", "event-supply"],
      risk: 9,
      alarmFlagged: true,
      apRoundNumber: 4,
      apRemaining: { "1": 2 },
    },
    EXPLORATION_ARCHIVE_ROOM,
    4
  );
}

function shortMap(): PublicExploration {
  const state = emptyExplorationState(PREVIEW_SEED);
  return project(
    {
      ...state,
      risk: 2,
      apRoundNumber: 2,
      apRemaining: { "1": 1 },
    },
    EXPLORATION_ENTRANCE,
    2
  );
}

function neighborId(exploration: PublicExploration): string {
  const neighbor = exploration.rooms.find((room) => !room.current);
  if (!neighbor) throw new Error("preview neighbor missing");
  return neighbor.id;
}

export default async function ExplorationPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ shot?: string }>;
}) {
  const { shot: raw } = await searchParams;
  const shot = shotOf(raw);
  const fog = unexplored();
  const neighbor = neighborId(fog);
  let exploration = fog;
  let queue: ExplorationCommand[] = [];
  let initiallyOpen = false;
  switch (shot) {
    case "collapsed":
      break;
    case "unexplored":
      initiallyOpen = true;
      break;
    case "discovered":
      exploration = discovered();
      initiallyOpen = true;
      break;
    case "queued":
      initiallyOpen = true;
      queue = [
        { op: "move", roomId: neighbor },
        { op: "search", depth: "normal" },
      ];
      break;
    case "short":
      exploration = shortMap();
      initiallyOpen = true;
      queue = [
        { op: "move", roomId: neighborId(shortMap()) },
        { op: "move", roomId: neighborId(shortMap()) },
        { op: "search", depth: "careful" },
      ];
      break;
    default: {
      const neverShot: never = shot;
      return neverShot;
    }
  }
  return <PreviewFrame exploration={exploration} queue={queue} initiallyOpen={initiallyOpen} title={shot} />;
}
