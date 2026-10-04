import { useState } from "react";
import { Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Empty, Table, TBody, THead } from "@/components/ui/table";
import { ErrorNote, Loading } from "@/components/admin/state";
import { usePasswordResets } from "@/queries/password";
import { relative } from "@/lib/format";

/**
 * Open "forgot password" requests. While no email provider is configured the
 * link is never sent automatically, so it waits here. Anyone can ask for a
 * reset on any address, so the link only ever goes to the account's own
 * email — never to whoever happens to message asking for it.
 */
export function PasswordResetsPanel() {
  const resets = usePasswordResets(true);
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>
          <span className="inline-flex items-center gap-2">
            <KeyRound className="size-4" /> Password resets
          </span>
        </PanelTitle>
        <Badge>{resets.data?.length ?? 0}</Badge>
      </PanelHeader>
      <PanelBody className="space-y-3">
        <ErrorNote error={resets.error} />
        <p className="text-xs text-muted-foreground">
          Links last 24 hours and disappear from this list once used. With no RESEND_API_KEY set nothing is emailed:
          copy the link and send it to the address shown, and only that address.
        </p>
        {resets.isLoading ? (
          <Loading />
        ) : (
          <Table>
            <THead>
              <tr>
                <th>Requested</th>
                <th>Account</th>
                <th>Send to</th>
                <th>Delivery</th>
                <th>Link</th>
              </tr>
            </THead>
            <TBody>
              {resets.data?.length === 0 && <Empty colSpan={5}>No open requests.</Empty>}
              {resets.data?.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap font-mono text-xs">{relative(r.createdAt)}</td>
                  <td className="font-medium">{r.username ?? "—"}</td>
                  <td className="text-xs">{r.email}</td>
                  <td>
                    <Badge tone={r.deliveredVia === "manual" ? "warn" : "live"}>{r.deliveredVia}</Badge>
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void navigator.clipboard.writeText(r.url).then(() => {
                          setCopied(r.id);
                          window.setTimeout(() => setCopied(null), 1_500);
                        })
                      }
                    >
                      <Copy className="size-3.5" /> {copied === r.id ? "Copied" : "Copy link"}
                    </Button>
                  </td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </PanelBody>
    </Panel>
  );
}
