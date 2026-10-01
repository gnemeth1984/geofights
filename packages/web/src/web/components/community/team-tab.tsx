import * as React from "react";
import { Crown, LogOut, MessageCircle, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateTeam, useJoinTeam, useLeaveTeam, useMyTeam, type ChatChannel } from "@/queries/community";
import { SafetyActions } from "./safety-actions";
import { ErrorLine, Muted, Row, SectionLabel, Spinner } from "./shared";

/**
 * One team per player, joined by code. Teams are single-tier: a team made by
 * an under-18 can only ever hold under-18s, and the same for adults.
 */
export function TeamTab({
  canHost,
  myPlayerId,
  onChat,
}: {
  canHost: boolean;
  myPlayerId: string | null;
  onChat: (channel: ChatChannel, title: string) => void;
}) {
  const team = useMyTeam(true);
  const leave = useLeaveTeam();

  if (team.isLoading) return <Spinner />;
  if (!team.data) return <NoTeam canHost={canHost} />;
  const t = team.data;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Users className="size-4 text-primary" />
        <span className="text-sm font-semibold">{t.name}</span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {t.memberCount}/{t.sizeLimit}
        </span>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 py-2">
        <span className="text-[11px] text-muted-foreground">Team code</span>
        <span className="font-mono text-sm font-semibold tracking-[0.2em]">{t.joinCode}</span>
      </div>
      <Muted>Give the code to friends in person. Anyone with it can join while there is room.</Muted>

      <div className="flex gap-1.5">
        <Button size="sm" onClick={() => onChat({ scope: "team", channelId: t.id }, `${t.name} team`)}>
          <MessageCircle className="size-3.5" /> Team chat
        </Button>
        <Button size="sm" variant="outline" disabled={leave.isPending} onClick={() => leave.mutate({})}>
          <LogOut className="size-3.5" /> Leave
        </Button>
      </div>

      <div className="space-y-1.5">
        <SectionLabel>Members</SectionLabel>
        {t.members.map((m) => (
          <Row key={m.playerId}>
            {m.role === "owner" && <Crown className="size-3.5 text-accent" />}
            <span className="truncate font-medium">{m.username}</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              lvl {m.level} · {m.wins}w
            </span>
            {m.blocked && <span className="text-[10px] text-muted-foreground">blocked</span>}
            <span className="ml-auto">
              {m.playerId !== myPlayerId && !m.blocked && (
                <SafetyActions playerId={m.playerId} username={m.username} context="team" refId={t.id} />
              )}
            </span>
          </Row>
        ))}
      </div>
      <ErrorLine error={leave.error} />
    </div>
  );
}

function NoTeam({ canHost }: { canHost: boolean }) {
  const create = useCreateTeam();
  const join = useJoinTeam();
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");

  return (
    <div className="space-y-4">
      <form
        className="space-y-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.trim().length >= 4) join.mutate({ code: code.trim().toUpperCase() });
        }}
      >
        <SectionLabel>Join a team</SectionLabel>
        <div className="flex gap-1.5">
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Team code"
            aria-label="Team code"
            autoComplete="off"
            maxLength={12}
            className="font-mono uppercase tracking-widest"
          />
          <Button type="submit" size="sm" disabled={join.isPending || code.trim().length < 4}>
            Join
          </Button>
        </div>
        <ErrorLine error={join.error} />
      </form>

      <form
        className="space-y-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim().length >= 3) create.mutate({ name: name.trim() });
        }}
      >
        <SectionLabel>Start a team</SectionLabel>
        {canHost ? (
          <>
            <div className="flex gap-1.5">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Team name"
                aria-label="Team name"
                maxLength={24}
              />
              <Button type="submit" size="sm" disabled={create.isPending || name.trim().length < 3}>
                <Plus className="size-3.5" /> Create
              </Button>
            </div>
            <Muted>Names are checked — no real names, schools, places or contact details.</Muted>
          </>
        ) : (
          <Muted>Teams are started by players aged 16 or over, after their first day. You can still join one.</Muted>
        )}
        <ErrorLine error={create.error} />
      </form>
    </div>
  );
}
