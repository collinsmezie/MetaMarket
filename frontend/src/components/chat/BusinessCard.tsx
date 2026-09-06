'use client';

import React from 'react';
import { CheckCircle2, MapPin, Phone, Star, Store } from 'lucide-react';

/**
 * Vendor business card.
 *
 * The markup is the client's existing supplier card, lifted out of `WhatsAppChatView` so both
 * the old view and the MCOS view render a matched seller the same way. Only the data source
 * changed: these come from `response.metadata.vendors` on the MCOS web channel rather than from
 * the AMKE search endpoint.
 *
 * WhatsApp gets the same vendors as text, because it has nothing else. This is a richer
 * rendering of identical data, not extra information — a buyer must not see a different
 * marketplace depending on which client they opened.
 */

export interface BusinessCardVendor {
  vendorId: string;
  vendorName: string;
  location: string;
  phone?: string | null;
  matchedConcept?: string | null;
  description?: string | null;
  rating?: string | null;
  score?: number;
}

interface BusinessCardProps {
  vendor: BusinessCardVendor;
  /** Shown as the match tier chip. */
  tier?: string;
}

export function BusinessCard({ vendor, tier }: BusinessCardProps) {
  const location = vendor.location || 'Nigeria';
  const phone = vendor.phone ?? '';
  const shortName = (vendor.vendorName || 'Vendor').split(' ')[0];

  const description =
    vendor.description ||
    (vendor.matchedConcept
      ? `Verified stockist for ${vendor.matchedConcept} in ${location}.`
      : `${shortName} sells products for this request.`);

  return (
    <div className="bg-[#111b21] p-3 rounded-xl border border-[#2a3942] hover:border-emerald-500/50 transition-all shadow-lg space-y-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 truncate min-w-0 flex-1">
          <Store className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-bold text-xs text-white truncate" title={vendor.vendorName}>
            {vendor.vendorName || vendor.vendorId}
          </span>
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        </div>

        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 shrink-0">
          {tier ?? 'Direct Match'}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-[11px]">
        <div className="flex items-center gap-0.5 text-amber-400">
          {[0, 1, 2, 3, 4].map((star) => (
            <Star key={star} className="w-3 h-3 fill-amber-400 text-amber-400" />
          ))}
        </div>
        {vendor.rating && <span className="font-bold text-amber-300">{vendor.rating}</span>}
      </div>

      <p className="text-[11px] text-slate-300 leading-snug">{description}</p>

      <div className="flex items-center justify-between pt-1.5 border-t border-[#2a3942]/50 gap-2">
        <div className="flex items-center gap-1 text-[11px] text-slate-400 truncate min-w-0">
          <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
          <span className="truncate">{location}</span>
        </div>

        {/* Only rendered when a number is actually on file. A dead "Call" button is worse than
            no button: the buyer blames the shop, not us. */}
        {phone.length > 0 && (
          <a
            href={`tel:${phone.replace(/\s+/g, '')}`}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] transition-all shadow-sm shrink-0 active:scale-95"
          >
            <Phone className="w-3 h-3" />
            <span>{phone}</span>
          </a>
        )}
      </div>
    </div>
  );
}
