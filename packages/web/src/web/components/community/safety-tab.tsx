import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBlocks, useUnblock } from "@/queries/community";
import { AGE_BAND_LABEL, type AgeBand } from "@/lib/geo";
import { relative } from "@/lib/format";
import { ErrorLine, Muted, Row, SectionLabel, Spinner } from "./shared";

/** The rules in plain words, and the list of people this player has blocked. */
export function SafetyTab({ ageBand, minor }: { ageBand: AgeBand | null; minor: boolean }) {
  const blocks = useBlocks(true);
  const unblock = useUnblock();

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs leading-relaxed">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-4 text-primary" />
          How GeoFights keeps you safe
        </div>
        <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
          <li>
            You are in the <span className="font-medium text-foreground">{minor ? "under-18" : "adult"}</span>{" "}
            group{ageBand ? ` (${AGE_BAND_LABEL[ageBand]})` : ""}. Adults and under-18s can never be friends,
            teammates, chat, fight or join the same meet-up.
          </li>
          <li>Friends are added by code only — nobody can search for you.</li>
          <li>Friends, teams, chat and meet-ups never show where you are — only the name of a park.</li>
          <li>
            Chat hides phone numbers, emails, links, addresses and other apps, and refuses requests to meet in
            private.
          </li>
          <li>Three separate reports take an account out of the game until a moderator checks it.</li>
        </ul>
        {minor && (
          <p className="font-medium text-foreground">
            If anyone makes you feel uncomfortable, report them, block them, and tell a grown-up you trust.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <SectionLabel>Blocked players</SectionLabel>
        {blocks.isLoading && <Spinner />}
        {blocks.data?.length === 0 && <Muted>You have not blocked anyone.</Muted>}
        {blocks.data?.map((b) => (
          <Row key={b.id}>
            <span className="truncate font-medium">{b.username}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{relative(b.createdAt)}</span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={unblock.isPending}
              onClick={() => unblock.mutate({ playerId: b.playerId })}
            >
              Unblock
            </Button>
          </Row>
        ))}
        <ErrorLine error={blocks.error ?? unblock.error} />
      </div>
    </div>
  );
}
