import * as React from "react";
import { Ban, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { RarityBadge, StatusBadge } from "@/components/ui/badge";
import { Empty, IdCell, Table, TBody, THead } from "@/components/ui/table";
import { Stat } from "@/components/admin/stat";
import { ErrorNote, Loading } from "@/components/admin/state";
import { useListings, useTakedownListing } from "@/queries/admin";
import { coins, dateTime, num, titleCase } from "@/lib/format";

type Status = "all" | "active" | "sold" | "cancelled";

/**
 * Marketplace moderation. The house takes a 10% fee on every sale, so the only
 * operator action here is a takedown: it pulls a listing without paying anyone
 * and releases the item back to its seller.
 */
export function MarketTab() {
  const [status, setStatus] = React.useState<Status>("all");
  const listings = useListings();
  const takedown = useTakedownListing();

  if (listings.isLoading) return <Loading label="Reading listings" />;
  if (listings.isError) return <ErrorNote error={listings.error} />;

  const rows = listings.data ?? [];
  const visible = status === "all" ? rows : rows.filter((row) => row.status === status);
  const active = rows.filter((row) => row.status === "active");
  const sold = rows.filter((row) => row.status === "sold");
  const volume = sold.reduce((total, row) => total + row.price, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="On the market"
          value={num(active.length)}
          tone={active.length ? "live" : "default"}
          hint="Active fixed-price listings"
        />
        <Stat label="Sold" value={num(sold.length)} hint="In this window" />
        <Stat label="Gross volume" value={coins(volume)} hint="Sum of sold prices" />
        <Stat
          label="House fees"
          value={coins(Math.round(volume * 0.1))}
          hint="10% of every sale"
        />
      </div>

      <Panel>
        <PanelHeader className="flex-wrap items-center justify-between gap-3">
          <PanelTitle className="flex items-center gap-2">
            <Store className="size-4 text-primary" />
            Listings
          </PanelTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor="market-status">Status</Label>
            <Select
              id="market-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as Status)}
              className="w-36"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="sold">Sold</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </div>
        </PanelHeader>
        <Table>
          <THead>
            <tr>
              <th>Item</th>
              <th>Type</th>
              <th>Rarity</th>
              <th>Price</th>
              <th>Status</th>
              <th>Seller</th>
              <th>Listed</th>
              <th className="text-right">Action</th>
            </tr>
          </THead>
          <TBody>
            {visible.length === 0 ? (
              <Empty colSpan={8}>No listings match this filter.</Empty>
            ) : (
              visible.map((listing) => (
                <tr key={listing.id}>
                  <td>
                    <div className="font-medium">{listing.itemName}</div>
                    <IdCell value={listing.id} />
                  </td>
                  <td className="text-muted-foreground">{titleCase(listing.itemType)}</td>
                  <td>
                    <RarityBadge rarity={listing.itemRarity} />
                  </td>
                  <td className="tabular font-medium text-accent">{coins(listing.price)}</td>
                  <td>
                    <StatusBadge status={listing.status} />
                  </td>
                  <td>
                    <IdCell value={listing.sellerId} />
                  </td>
                  <td className="text-muted-foreground">
                    {listing.status === "sold"
                      ? dateTime(listing.soldAt)
                      : dateTime(listing.createdAt)}
                  </td>
                  <td aria-label="Row actions">
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={takedown.isPending || listing.status !== "active"}
                        onClick={() => takedown.mutate({ listingId: listing.id })}
                        title="Remove from the market and return the item"
                      >
                        <Ban className="size-4" />
                        Takedown
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </TBody>
        </Table>
        {takedown.isError ? (
          <PanelBody className="pt-0">
            <ErrorNote error={takedown.error} />
          </PanelBody>
        ) : null}
      </Panel>
    </div>
  );
}
