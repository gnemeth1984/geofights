import { Coins } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Empty, IdCell, Table, TBody, THead } from "@/components/ui/table";
import { Stat } from "@/components/admin/stat";
import { ErrorNote, Loading } from "@/components/admin/state";
import { useEconomy } from "@/queries/admin";
import { coins, dateTime, num, titleCase } from "@/lib/format";

const TYPE_TONE: Record<string, "neutral" | "live" | "warn" | "info" | "epic" | "bad"> = {
  market_sale: "info",
  shop_purchase: "warn",
  battle_reward: "live",
  nature_pickup: "epic",
  upgrade: "neutral",
  admin_grant: "bad",
};

/**
 * Currency health. Every coin that moves is a `transaction` row, so faucets
 * (battle rewards, nature pickups, admin grants) and sinks (shop purchases,
 * upgrades, the 10% market fee) can be read off one ledger.
 */
export function EconomyTab() {
  const economy = useEconomy();

  if (economy.isLoading) return <Loading label="Reading the ledger" />;
  if (economy.isError) return <ErrorNote error={economy.error} />;

  const data = economy.data;
  if (!data) return null;
  const perPlayer = data.players ? Math.round(data.currencyInCirculation / data.players) : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="In circulation"
          value={coins(data.currencyInCirculation)}
          tone="live"
          hint={`Held by ${num(data.players)} players`}
        />
        <Stat label="Average balance" value={coins(perPlayer)} hint="Per player" />
        <Stat
          label="Market volume"
          value={coins(data.salesVolume)}
          hint={`${num(data.sales)} completed sales`}
        />
        <Stat
          label="Fees collected"
          value={coins(data.feesCollected)}
          tone="warn"
          hint="10% house cut, removed from supply"
        />
      </div>

      <Panel>
        <PanelHeader>
          <PanelTitle className="flex items-center gap-2">
            <Coins className="size-4 text-accent" />
            Recent transactions
          </PanelTitle>
        </PanelHeader>
        <Table>
          <THead>
            <tr>
              <th>Type</th>
              <th>Amount</th>
              <th>Fee</th>
              <th>Net</th>
              <th>From</th>
              <th>To</th>
              <th>Note</th>
              <th>When</th>
            </tr>
          </THead>
          <TBody>
            {data.recentTransactions.length === 0 ? (
              <Empty colSpan={8}>No currency has moved yet.</Empty>
            ) : (
              data.recentTransactions.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Badge tone={TYPE_TONE[row.type] ?? "neutral"}>
                      {titleCase(row.type)}
                    </Badge>
                  </td>
                  <td className="tabular">{coins(row.amount)}</td>
                  <td className="tabular text-muted-foreground">
                    {row.fee ? coins(row.fee) : "—"}
                  </td>
                  <td className="tabular font-medium text-primary">{coins(row.netAmount)}</td>
                  <td>
                    <IdCell value={row.fromPlayerId} />
                  </td>
                  <td>
                    <IdCell value={row.toPlayerId} />
                  </td>
                  <td className="max-w-[26ch] truncate text-xs text-muted-foreground">
                    {row.note ?? "—"}
                  </td>
                  <td className="text-muted-foreground">{dateTime(row.createdAt)}</td>
                </tr>
              ))
            )}
          </TBody>
        </Table>
      </Panel>
    </div>
  );
}
