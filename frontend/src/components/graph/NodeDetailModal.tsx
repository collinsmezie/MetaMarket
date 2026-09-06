'use client';

import React, { useMemo, useState } from 'react';
import { GraphNode, GraphLink } from '@/lib/types';
import {
  X,
  Layers,
  Store,
  ShoppingBag,
  MessageSquare,
  Sparkles,
  Tag,
  MapPin,
  Building2,
  GitCommit,
  FolderTree,
  ChevronRight,
  Package,
  Users,
  Info,
} from 'lucide-react';

interface NodeDetailModalProps {
  node: GraphNode | null;
  allNodes?: GraphNode[];
  allLinks?: GraphLink[];
  onClose: () => void;
}

export const NodeDetailModal: React.FC<NodeDetailModalProps> = ({
  node,
  allNodes = [],
  allLinks = [],
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'hierarchy' | 'connected' | 'properties'>('hierarchy');

  // Compute full hierarchy breadcrumbs & connected graph entities
  const connections = useMemo(() => {
    if (!node) return null;

    const nodeId = String(node.id);
    const nodeGroup = String(node.group || '').toUpperCase();

    // Maps for fast node lookups
    const nodesById = new Map<string, GraphNode>();
    for (const n of allNodes) {
      nodesById.set(String(n.id), n);
    }

    // Find outgoing and incoming links for current node
    const outgoing = allLinks.filter((l: any) => String(l.source?.id || l.source) === nodeId);
    const incoming = allLinks.filter((l: any) => String(l.target?.id || l.target) === nodeId);

    let gpcClass: GraphNode | null = null;
    let gpcFamily: GraphNode | null = null;
    let gpcSegment: GraphNode | null = null;

    const connectedSellers: Array<{ node: GraphNode; status?: string }> = [];
    const connectedBuyers: Array<{ node: GraphNode }> = [];
    const connectedConcepts: Array<{ node: GraphNode }> = [];
    const connectedPhrases: Array<{ node: GraphNode }> = [];
    const siblingClasses: Array<{ node: GraphNode }> = [];
    const childClasses: Array<{ node: GraphNode }> = [];
    const childFamilies: Array<{ node: GraphNode }> = [];

    // Helper to resolve node reference
    const resolveNode = (ref: any): GraphNode | null => {
      if (typeof ref === 'object' && ref !== null && ref.id) return ref as GraphNode;
      const strId = String(ref);
      return nodesById.get(strId) || null;
    };

    // Case 1: Clicked Node is GpcClass
    if (nodeGroup.includes('CLASS')) {
      gpcClass = node;

      // Find parent GpcFamily
      for (const link of outgoing) {
        if (link.label === 'BELONGS_TO_FAMILY') {
          gpcFamily = resolveNode(link.target);
          break;
        }
      }

      // If parent family found, find parent GpcSegment
      if (gpcFamily) {
        const famId = String(gpcFamily.id);
        const famOutgoing = allLinks.filter((l: any) => String(l.source?.id || l.source) === famId);
        for (const link of famOutgoing) {
          if (link.label === 'BELONGS_TO_SEGMENT') {
            gpcSegment = resolveNode(link.target);
            break;
          }
        }

        // Find sibling classes in same family
        const famIncoming = allLinks.filter(
          (l: any) => String(l.target?.id || l.target) === famId && l.label === 'BELONGS_TO_FAMILY'
        );
        for (const link of famIncoming) {
          const sibling = resolveNode(link.source);
          if (sibling && String(sibling.id) !== nodeId) {
            siblingClasses.push({ node: sibling });
          }
        }
      }

      // Find connected Vendors, Concepts, and Phrases
      for (const link of incoming) {
        const sourceNode = resolveNode(link.source);
        if (!sourceNode) continue;
        const srcGroup = String(sourceNode.group || '').toUpperCase();

        if (link.label === 'SUPPLIES_GPC_CLASS' || srcGroup.includes('SELLER') || srcGroup.includes('VENDOR')) {
          connectedSellers.push({ node: sourceNode, status: (link as any).status || 'CONFIRMED' });
        } else if (link.label === 'MAPPED_TO_GPC' || srcGroup.includes('CONCEPT')) {
          connectedConcepts.push({ node: sourceNode });

          // Find phrases connected to this concept
          const concId = String(sourceNode.id);
          const concIncoming = allLinks.filter(
            (l: any) => String(l.target?.id || l.target) === concId && l.label === 'EXTRACTS_CONCEPT'
          );
          for (const cLink of concIncoming) {
            const phraseNode = resolveNode(cLink.source);
            if (phraseNode && !connectedPhrases.some((p) => String(p.node.id) === String(phraseNode.id))) {
              connectedPhrases.push({ node: phraseNode });
            }
          }
        }
      }
    }
    // Case 2: Clicked Node is GpcFamily
    else if (nodeGroup.includes('FAMILY')) {
      gpcFamily = node;

      // Find parent GpcSegment
      for (const link of outgoing) {
        if (link.label === 'BELONGS_TO_SEGMENT') {
          gpcSegment = resolveNode(link.target);
          break;
        }
      }

      // Find child GpcClasses belonging to this family
      for (const link of incoming) {
        if (link.label === 'BELONGS_TO_FAMILY') {
          const childCls = resolveNode(link.source);
          if (childCls) {
            childClasses.push({ node: childCls });

            // Find vendors supplying these child classes
            const childId = String(childCls.id);
            const childIncoming = allLinks.filter(
              (l: any) => String(l.target?.id || l.target) === childId && l.label === 'SUPPLIES_GPC_CLASS'
            );
            for (const cLink of childIncoming) {
              const vendor = resolveNode(cLink.source);
              if (vendor && !connectedSellers.some((v) => String(v.node.id) === String(vendor.id))) {
                connectedSellers.push({ node: vendor, status: (cLink as any).status || 'CONFIRMED' });
              }
            }
          }
        }
      }
    }
    // Case 3: Clicked Node is GpcSegment
    else if (nodeGroup.includes('SEGMENT')) {
      gpcSegment = node;

      // Find child GpcFamilies belonging to this segment
      for (const link of incoming) {
        if (link.label === 'BELONGS_TO_SEGMENT') {
          const childFam = resolveNode(link.source);
          if (childFam) {
            childFamilies.push({ node: childFam });
          }
        }
      }
    }
    // Case 4: Clicked Node is Actor / Seller / Vendor / Buyer
    else if (nodeGroup.includes('SELLER') || nodeGroup.includes('VENDOR') || nodeGroup.includes('BUYER') || nodeGroup.includes('ACTOR')) {
      for (const link of outgoing) {
        if (link.label === 'SUPPLIES_GPC_CLASS') {
          const cls = resolveNode(link.target);
          if (cls) {
            childClasses.push({ node: cls });

            // Find parent family for first class
            if (!gpcFamily) {
              const clsId = String(cls.id);
              const clsOutgoing = allLinks.filter((l: any) => String(l.source?.id || l.source) === clsId);
              for (const cLink of clsOutgoing) {
                if (cLink.label === 'BELONGS_TO_FAMILY') {
                  gpcFamily = resolveNode(cLink.target);
                  break;
                }
              }
            }
          }
        }
      }
    }
    // Case 5: Clicked Node is Concept or Phrase
    else if (nodeGroup.includes('CONCEPT') || nodeGroup.includes('PHRASE')) {
      let conceptNode = nodeGroup.includes('CONCEPT') ? node : null;

      if (nodeGroup.includes('PHRASE')) {
        connectedPhrases.push({ node });
        for (const link of outgoing) {
          if (link.label === 'EXTRACTS_CONCEPT') {
            conceptNode = resolveNode(link.target);
            break;
          }
        }
      }

      if (conceptNode) {
        connectedConcepts.push({ node: conceptNode });
        const concId = String(conceptNode.id);
        const concOutgoing = allLinks.filter((l: any) => String(l.source?.id || l.source) === concId);

        for (const link of concOutgoing) {
          if (link.label === 'MAPPED_TO_GPC') {
            gpcClass = resolveNode(link.target);
            if (gpcClass) {
              const clsId = String(gpcClass.id);
              const clsOutgoing = allLinks.filter((l: any) => String(l.source?.id || l.source) === clsId);
              for (const cLink of clsOutgoing) {
                if (cLink.label === 'BELONGS_TO_FAMILY') {
                  gpcFamily = resolveNode(cLink.target);
                  break;
                }
              }
            }
            break;
          }
        }
      }
    }

    return {
      gpcClass,
      gpcFamily,
      gpcSegment,
      connectedSellers,
      connectedBuyers,
      connectedConcepts,
      connectedPhrases,
      siblingClasses,
      childClasses,
      childFamilies,
    };
  }, [node, allNodes, allLinks]);

  if (!node) return null;

  const groupUpper = String(node.group || '').toUpperCase();

  const getThemeColor = () => {
    if (groupUpper.includes('SEGMENT')) return '#3b82f6';
    if (groupUpper.includes('FAMILY')) return '#a855f7';
    if (groupUpper.includes('CLASS')) return '#f59e0b';
    if (groupUpper.includes('SELLER') || groupUpper.includes('VENDOR')) return '#10b981';
    if (groupUpper.includes('BUYER')) return '#06b6d4';
    if (groupUpper.includes('PHRASE')) return '#ec4899';
    return '#8b5cf6';
  };

  const themeColor = getThemeColor();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-3xl p-6 shadow-2xl space-y-5 text-slate-100 max-h-[85vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-start justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center text-white font-bold shadow-lg shrink-0"
              style={{ backgroundColor: themeColor }}
            >
              {groupUpper.includes('SELLER') || groupUpper.includes('VENDOR') ? (
                <Store className="w-6 h-6 text-white" />
              ) : groupUpper.includes('BUYER') ? (
                <ShoppingBag className="w-6 h-6 text-white" />
              ) : groupUpper.includes('PHRASE') ? (
                <MessageSquare className="w-6 h-6 text-white" />
              ) : groupUpper.includes('CONCEPT') ? (
                <Sparkles className="w-6 h-6 text-white" />
              ) : groupUpper.includes('SEGMENT') ? (
                <Building2 className="w-6 h-6 text-white" />
              ) : groupUpper.includes('FAMILY') ? (
                <FolderTree className="w-6 h-6 text-white" />
              ) : (
                <Tag className="w-6 h-6 text-white" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span
                  className="text-[10px] uppercase font-extrabold tracking-wider px-2 py-0.5 rounded-full font-mono text-white shadow-sm"
                  style={{ backgroundColor: themeColor }}
                >
                  {node.group || 'Node'}
                </span>
                {(node as any).code && (
                  <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/40">
                    GPC {(node as any).code}
                  </span>
                )}
              </div>
              <h3 className="font-extrabold text-lg text-white capitalize mt-1 line-clamp-1">
                {node.name || node.title || node.id}
              </h3>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-2xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center space-x-1 p-1 bg-slate-950/60 rounded-2xl border border-slate-800 shrink-0">
          <button
            onClick={() => setActiveTab('hierarchy')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'hierarchy'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <GitCommit className="w-3.5 h-3.5" />
            Hierarchy & Path
          </button>
          <button
            onClick={() => setActiveTab('connected')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'connected'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Connected ({connections?.connectedSellers.length || 0} Vendors)
          </button>
          <button
            onClick={() => setActiveTab('properties')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'properties'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Info className="w-3.5 h-3.5" />
            Node Properties
          </button>
        </div>

        {/* Tab Content Area */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1 custom-scrollbar">
          {/* TAB 1: HIERARCHY & PLACEMENT */}
          {activeTab === 'hierarchy' && (
            <div className="space-y-4">
              {/* Sovereign GPC Hierarchy Flow */}
              <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-3">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Sovereign GS1 GPC Hierarchy Placement
                </span>

                <div className="space-y-2 text-xs">
                  {/* Segment */}
                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-blue-950/40 border border-blue-800/40">
                    <Building2 className="w-4 h-4 text-blue-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] text-blue-400 font-bold block uppercase">GPC Segment</span>
                      <span className="font-semibold text-slate-200 line-clamp-1">
                        {connections?.gpcSegment
                          ? `${connections.gpcSegment.name} (${(connections.gpcSegment as any).code || 'Segment'})`
                          : 'GS1 Sovereign Segment'}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-center text-slate-600">
                    <ChevronRight className="w-4 h-4 rotate-90" />
                  </div>

                  {/* Family */}
                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-purple-950/40 border border-purple-800/40">
                    <FolderTree className="w-4 h-4 text-purple-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] text-purple-400 font-bold block uppercase">GPC Family</span>
                      <span className="font-semibold text-slate-200 line-clamp-1">
                        {connections?.gpcFamily
                          ? `${connections.gpcFamily.name} (${(connections.gpcFamily as any).code || 'Family'})`
                          : 'GS1 Sovereign Family'}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-center text-slate-600">
                    <ChevronRight className="w-4 h-4 rotate-90" />
                  </div>

                  {/* Class */}
                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-950/40 border border-amber-800/40">
                    <Tag className="w-4 h-4 text-amber-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] text-amber-400 font-bold block uppercase">GPC Class</span>
                      <span className="font-semibold text-amber-200 line-clamp-1">
                        {connections?.gpcClass
                          ? `${connections.gpcClass.name} (${(connections.gpcClass as any).code || 'Class'})`
                          : node.name}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sibling Classes in Same Family */}
              {connections?.siblingClasses && connections.siblingClasses.length > 0 && (
                <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-2.5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Family Sibling Classes ({connections.siblingClasses.length})
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {connections.siblingClasses.map((s, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold bg-amber-950/30 text-amber-300 border border-amber-500/30"
                      >
                        <Tag className="w-3 h-3" />
                        {s.node.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Child Families / Classes for Segment/Family Nodes */}
              {connections?.childFamilies && connections.childFamilies.length > 0 && (
                <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-2.5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Underlying Product Families ({connections.childFamilies.length})
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {connections.childFamilies.map((f, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold bg-purple-950/40 text-purple-300 border border-purple-500/30"
                      >
                        <FolderTree className="w-3 h-3" />
                        {f.node.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {connections?.childClasses && connections.childClasses.length > 0 && (
                <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-2.5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Child GPC Category Classes ({connections.childClasses.length})
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {connections.childClasses.map((c, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold bg-amber-950/30 text-amber-300 border border-amber-500/30"
                      >
                        <Tag className="w-3 h-3" />
                        {c.node.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: CONNECTED VENDORS, CONCEPTS & PHRASES */}
          {activeTab === 'connected' && (
            <div className="space-y-4">
              {/* Connected Merchants / Vendors */}
              <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-3">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Attached Vendors & Stockists ({connections?.connectedSellers.length || 0})
                </span>

                {connections?.connectedSellers.length === 0 ? (
                  <span className="text-xs text-slate-500 italic block py-2">
                    No active merchants attached directly to this category node yet.
                  </span>
                ) : (
                  <div className="space-y-2">
                    {connections?.connectedSellers.map((v, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                            <Store className="w-4 h-4" />
                          </div>
                          <div>
                            <h5 className="font-bold text-xs text-slate-100">{v.node.name}</h5>
                            <span className="text-[10px] text-slate-400 flex items-center gap-1">
                              <MapPin className="w-2.5 h-2.5 text-slate-500" />
                              {(v.node.properties as any)?.location || (v.node as any).details?.location || 'Surulere'}
                            </span>
                          </div>
                        </div>

                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            v.status === 'CONFIRMED'
                              ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                              : 'bg-amber-950/60 text-amber-300 border-amber-500/40'
                          }`}
                        >
                          {v.status || 'CONFIRMED'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Connected Trade Concepts */}
              {connections?.connectedConcepts && connections.connectedConcepts.length > 0 && (
                <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-2.5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Normalized Trade Concepts ({connections.connectedConcepts.length})
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {connections.connectedConcepts.map((c, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold bg-cyan-950/40 text-cyan-300 border border-cyan-500/30"
                      >
                        <Sparkles className="w-3 h-3 text-cyan-400" />
                        {c.node.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Connected Buyer Speech Phrases */}
              {connections?.connectedPhrases && connections.connectedPhrases.length > 0 && (
                <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-2.5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Buyer Natural Speech Queries ({connections.connectedPhrases.length})
                  </span>
                  <div className="space-y-2">
                    {connections.connectedPhrases.map((p, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-2 text-xs text-slate-200"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-pink-400 shrink-0" />
                        <span className="italic">&quot;{p.node.name}&quot;</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: COMPLETE NODE PROPERTIES GRID */}
          {activeTab === 'properties' && (
            <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-3 text-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Graph Node Properties & Data Payload
              </span>

              <div className="space-y-2 font-mono">
                <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400">
                  <span>Graph Node ID:</span>
                  <span className="font-bold text-slate-100 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                    {node.id}
                  </span>
                </div>

                <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400">
                  <span>Node Group Label:</span>
                  <span className="font-bold text-purple-300">{node.group}</span>
                </div>

                {(node as any).code && (
                  <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400">
                    <span>GPC Classification Code:</span>
                    <span className="font-bold text-amber-400 font-mono">{(node as any).code}</span>
                  </div>
                )}

                {(node.properties as any)?.location && (
                  <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400">
                    <span>Market Location:</span>
                    <span className="font-bold text-emerald-300">{(node.properties as any).location}</span>
                  </div>
                )}

                {(node.properties as any)?.phone && (
                  <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400">
                    <span>Merchant Contact:</span>
                    <span className="font-bold text-slate-200">{(node.properties as any).phone}</span>
                  </div>
                )}

                {(node.properties as any)?.status && (
                  <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400">
                    <span>Attachment Status:</span>
                    <span className="font-bold text-cyan-300">{(node.properties as any).status}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between shrink-0 pt-3 border-t border-slate-800">
          <span className="text-[11px] text-slate-500 font-mono">
            AMKE 2.0 Sovereign Graph Observer
          </span>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-extrabold text-xs transition-all shadow-lg"
          >
            Close Details
          </button>
        </div>
      </div>
    </div>
  );
};
