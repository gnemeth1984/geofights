import * as React from "react";
import { CalendarPlus, MapPin, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useCancelMeetup,
  useCreateMeetup,
  useJoinMeetup,
  useLeaveMeetup,
  useMeetups,
  useParkBoard,
} from "@/queries/community";
import { dateTime } from "@/lib/format";
import { SafetyActions } from "./safety-actions";
import { ErrorLine, Muted, Row, SectionLabel, Spinner } from "./shared";

/** Same window the server enforces, checked here in the player's own clock. */
const EARLIEST_HOUR = 8;
const LATEST_HOUR = 20;

type Zone = { id: string; name: string } | null;

/**
 * Meet-ups happen only at approved parks, in daylight hours, and only with
 * players of the same age group. The host is 16+; nobody's location is shown,
 * only the park.
 */
export function MeetupsTab({
  zone,
  canHost,
  minor,
  myPlayerId,
}: {
  zone: Zone;
  canHost: boolean;
  minor: boolean;
  myPlayerId: string | null;
}) {
  const meetups = useMeetups(true);
  const join = useJoinMeetup();
  const leave = useLeaveMeetup();
  const cancel = useCancelMeetup();
  const busy = join.isPending || leave.isPending || cancel.isPending;

  return (
    <div className="space-y-4">
      {minor && (
        <div className="rounded-md border border-accent/40 bg-accent/10 p-2.5 text-xs leading-relaxed">
          Bring a parent or another grown-up you trust to every meet-up, and stay in the open part of the park.
        </div>
      )}

      <div className="space-y-1.5">
        <SectionLabel>Upcoming</SectionLabel>
        {meetups.isLoading && <Spinner />}
        {meetups.data?.length === 0 && <Muted>Nothing planned yet.</Muted>}
        {meetups.data?.map((m) => (
          <Row key={m.id}>
            <span className="min-w-0">
              <span className="block truncate font-medium">{m.title}</span>
              <span className="block font-mono text-[10px] text-muted-foreground">
                {dateTime(m.startsAt)} · {m.zoneName} · {m.attendeeCount}/{m.capacity}
              </span>
              <span className="block text-[10px] text-muted-foreground">host {m.hostName}</span>
            </span>
            <span className="ml-auto inline-flex items-center gap-1">
              {m.isHost ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => cancel.mutate({ meetupId: m.id })}>
                  Cancel
                </Button>
              ) : m.joined ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => leave.mutate({ meetupId: m.id })}>
                  Leave
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={busy || m.attendeeCount >= m.capacity}
                  onClick={() => join.mutate({ meetupId: m.id })}
                >
                  Join
                </Button>
              )}
              {!m.isHost && (
                <SafetyActions playerId={m.hostId} username={m.hostName} context="meetup" refId={m.id} />
              )}
            </span>
          </Row>
        ))}
        <ErrorLine error={meetups.error ?? join.error ?? leave.error ?? cancel.error} />
      </div>

      {canHost ? (
        <HostForm zone={zone} />
      ) : (
        <Muted>Meet-ups are hosted by players aged 16 or over, after their first day.</Muted>
      )}

      <ParkBoard zone={zone} myPlayerId={myPlayerId} />
    </div>
  );
}

function defaultStart() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setHours(15, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function HostForm({ zone }: { zone: Zone }) {
  const create = useCreateMeetup();
  const [title, setTitle] = React.useState("");
  const [when, setWhen] = React.useState(defaultStart);
  const [local, setLocal] = React.useState<string | null>(null);

  if (!zone) {
    return <Muted>Go to an approved park to host a meet-up there.</Muted>;
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const start = new Date(when);
    if (Number.isNaN(start.getTime())) return setLocal("Pick a date and time.");
    if (start.getHours() < EARLIEST_HOUR || start.getHours() >= LATEST_HOUR) {
      return setLocal(`Meet-ups run between ${EARLIEST_HOUR}:00 and ${LATEST_HOUR}:00.`);
    }
    setLocal(null);
    create.mutate(
      {
        zoneId: zone.id,
        title: title.trim(),
        startsAt: start.toISOString(),
        tzOffsetMinutes: start.getTimezoneOffset(),
      },
      { onSuccess: () => setTitle("") },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-1.5">
      <SectionLabel>Host at {zone.name}</SectionLabel>
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="What's the plan? e.g. Saturday battles"
        aria-label="Meet-up title"
        maxLength={48}
      />
      <div className="flex gap-1.5">
        <Input
          type="datetime-local"
          value={when}
          onChange={(event) => setWhen(event.target.value)}
          aria-label="Start time"
        />
        <Button type="submit" size="sm" disabled={create.isPending || title.trim().length < 3}>
          <CalendarPlus className="size-3.5" /> Post
        </Button>
      </div>
      <Muted>Between 8:00 and 20:00, at least 30 minutes from now, up to two weeks ahead.</Muted>
      {local && <p className="text-xs text-destructive">{local}</p>}
      <ErrorLine error={create.error} />
    </form>
  );
}

function ParkBoard({ zone, myPlayerId }: { zone: Zone; myPlayerId: string | null }) {
  const board = useParkBoard(zone?.id ?? null);
  return (
    <div className="space-y-1.5">
      <SectionLabel>
        <span className="inline-flex items-center gap-1">
          <Trophy className="size-3" /> Park leaderboard · 30 days
        </span>
      </SectionLabel>
      {!zone && <Muted>Stand in a park to see who rules it.</Muted>}
      {zone && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <MapPin className="size-3" /> {zone.name}
        </div>
      )}
      {board.isLoading && <Spinner />}
      {board.data?.length === 0 && <Muted>No wins here yet — be the first.</Muted>}
      {board.data?.map((e) => (
        <Row key={e.playerId}>
          <span className="w-5 font-mono text-[11px] text-muted-foreground">#{e.rank}</span>
          <span className="truncate font-medium">{e.username}</span>
          <span className="font-mono text-[10px] text-muted-foreground">lvl {e.level}</span>
          <span className="ml-auto font-mono text-[11px]">{e.wins}w</span>
          {e.playerId !== myPlayerId && (
            <SafetyActions playerId={e.playerId} username={e.username} context="profile" />
          )}
        </Row>
      ))}
      <ErrorLine error={board.error} />
    </div>
  );
}
