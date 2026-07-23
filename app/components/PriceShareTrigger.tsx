"use client";

import { ShareForwardLine } from "@mingcute/react";
import { usePriceShare } from "./PriceShareContext";

export function PriceShareTrigger({ disabled = false }: { disabled?: boolean }) {
  const { openShare } = usePriceShare();

  return (
    <button className="store-button" type="button" onClick={openShare} disabled={disabled}>
      <ShareForwardLine className="ui-icon" aria-hidden="true" />
      分享比价
    </button>
  );
}
