'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { GraphData, GraphNode, GraphLink } from '@/lib/types';
import { getGraphState } from '@/lib/api';
import { getTelemetrySocket } from '@/lib/socket';
import { NodeDetailModal } from './NodeDetailModal';
import {
  Search,
  RefreshCw,
  Store,
  ShoppingBag,
  UserCheck,
  ChevronRight,
  Sparkles,
  Layers,
  Building2,
  Package,
  MapPin,
  Phone,
  Tag,
  MessageSquare,
  ListFilter,
  X,
  Target,
} from 'lucide-react';

// Dynamically load ForceGraph2D with ssr disabled
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col items-center justify-center h-[500px] text-slate-400">
      <RefreshCw className="w-6 h-6 animate-spin text-purple-400 mb-2" />
      <span className="text-xs">Initializing AMKE Vector Concept Graph Canvas...</span>
    </div>
  ),
});

interface MarketGraphViewProps {
  isActive?: boolean;
  searchQuery?: string;
  selectedActorId?: string;
}

export type ViewPerspective = 'class_cluster' | 'family_view' | 'segment_view' | 'vendors' | 'buyers';

export const MarketGraphView: React.FC<MarketGraphViewProps> = ({
  isActive = true,
  searchQuery: externalSearchQuery,
  selectedActorId,
}) => {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [searchQuery, setSearchQuery] = useState('');
  const [panelSearch, setPanelSearch] = useState('');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredLink, setHoveredLink] = useState<GraphLink | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const graphRef = useRef<any>(null);

  const [viewPerspective, setViewPerspective] = useState<ViewPerspective>('class_cluster');

  const activeSearch = externalSearchQuery !== undefined ? externalSearchQuery : searchQuery;

  const fetchGraph = async () => {
    setIsLoading(true);
    try {
      const data = await getGraphState(10000);
      setGraphData(data);
    } catch (err) {
      console.error('Failed to load AMKE graph data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Re-fetch when tab becomes active
  useEffect(() => {
    if (isActive) {
      fetchGraph();
    }
  }, [isActive]);

  // Auto-select and focus graph node when selectedActorId or externalSearchQuery changes
  useEffect(() => {
    const nodes = graphData && Array.isArray(graphData.nodes) ? graphData.nodes : [];
    if (nodes.length > 0 && (selectedActorId || activeSearch)) {
      const query = String(selectedActorId || activeSearch).toLowerCase();
      const matchedNode = nodes.find(
        (n: any) =>
          (n.id && String(n.id).toLowerCase().includes(query)) ||
          (n.name && String(n.name).toLowerCase().includes(query)) ||
          (n.label && String(n.label).toLowerCase().includes(query)) ||
          (n.title && String(n.title).toLowerCase().includes(query))
      );
      if (matchedNode) {
        setSelectedNode(matchedNode);
        if (graphRef.current && (matchedNode as any).x !== undefined) {
          graphRef.current.centerAt((matchedNode as any).x, (matchedNode as any).y, 1000);
          graphRef.current.zoom(2.5, 1000);
        }
      }
    }
  }, [selectedActorId, activeSearch, graphData]);

  useEffect(() => {
    fetchGraph();

    const socket = getTelemetrySocket();
    socket.on('graph:updated', () => {
      fetchGraph();
    });

    const handleCustomRefresh = () => {
      fetchGraph();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('amke:graph-refresh', handleCustomRefresh);
    }

    return () => {
      socket.off('graph:updated');
      if (typeof window !== 'undefined') {
        window.removeEventListener('amke:graph-refresh', handleCustomRefresh);
      }
    };
  }, []);

  // Helper to sanitize node names: strip group prefixes, numeric codes, brackets
  const sanitizeNodeName = (raw: any): string => {
    if (!raw) return '';
    return String(raw)
      .replace(/^(GpcClass|GpcFamily|GpcSegment|Concept|Phrase|Actor|Vendor):\s*/i, '')
      .replace(/\s*\(\d+\)\s*$/g, '')
      .replace(/\s*\[\d+\]\s*$/g, '')
      .replace(/^\[|\]$/g, '')
      .trim();
  };

  // Center canvas on node when card clicked
  const focusOnNode = (nodeId: string) => {
    const rawNodes = (graphData && Array.isArray(graphData.nodes)) ? graphData.nodes : [];
    const matchedNode = rawNodes.find(
      (n: any) => n.id === nodeId || (n.id && String(n.id).toLowerCase() === String(nodeId).toLowerCase())
    );
    if (matchedNode) {
      setSelectedNode(matchedNode);
      if (graphRef.current && (matchedNode as any).x !== undefined) {
        graphRef.current.centerAt((matchedNode as any).x, (matchedNode as any).y, 1000);
        graphRef.current.zoom(2.8, 1000);
      }
    }
  };

  // Compute vendor nodes and their attached GPC Class clusters
  const vendorListSummary = useMemo(() => {
    const rawNodes = (graphData && Array.isArray(graphData.nodes)) ? graphData.nodes : [];
    const rawLinks = (graphData && Array.isArray(graphData.links))
      ? graphData.links
      : ((graphData as any) && Array.isArray((graphData as any).edges))
      ? (graphData as any).edges.map((e: any) => ({ source: e.from, target: e.to, label: e.label }))
      : [];

    const nodesById = new Map<string, any>(rawNodes.map((n: any) => [n.id, n]));

    const vendors: Array<{
      id: string;
      name: string;
      location: string;
      phone: string;
      attachedClasses: Array<{ code?: string; title: string }>;
    }> = [];

    for (const n of rawNodes) {
      const groupStr = (n.group as string) || '';
      const isVendor =
        groupStr === 'Actor' ||
        groupStr === 'Vendor' ||
        groupStr === 'SELLER' ||
        String(n.id).startsWith('seller_') ||
        ((n as any).properties && (n as any).properties.type === 'SELLER');

      if (isVendor) {
        const vendorId = n.id;
        const vendorName = sanitizeNodeName((n as any).label || n.name || ((n as any).properties && (n as any).properties.name) || (n as any).title || n.id);
        const location = ((n as any).properties && (n as any).properties.location) || (n as any).location || 'Lagos Market';
        const phone = ((n as any).properties && (n as any).properties.phone) || (n as any).phone || '+234 800 000 0000';

        const attachedClasses: Array<{ code?: string; title: string }> = [];

        for (const l of rawLinks) {
          const srcId = typeof l.source === 'object' ? (l.source as any).id : l.source;
          const tgtId = typeof l.target === 'object' ? (l.target as any).id : l.target;

          if (srcId === vendorId && l.label === 'SUPPLIES_GPC_CLASS') {
            const targetClassNode = nodesById.get(tgtId);
            if (targetClassNode) {
              const classTitle = sanitizeNodeName(
                targetClassNode.label || targetClassNode.name || (targetClassNode.properties && targetClassNode.properties.title) || targetClassNode.title || targetClassNode.id
              );
              if (!attachedClasses.some((c) => c.title === classTitle)) {
                attachedClasses.push({
                  code: targetClassNode.code || (targetClassNode.properties && targetClassNode.properties.code),
                  title: classTitle,
                });
              }
            }
          }
        }

        vendors.push({
          id: vendorId,
          name: vendorName,
          location,
          phone,
          attachedClasses,
        });
      }
    }

    if (panelSearch.trim()) {
      const q = panelSearch.toLowerCase();
      return vendors.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.location.toLowerCase().includes(q) ||
          v.attachedClasses.some((c) => c.title.toLowerCase().includes(q))
      );
    }

    return vendors;
  }, [graphData, panelSearch]);

  // Compute buyer nodes, search phrases, extracted concepts & attached GPC Classes
  const buyerListSummary = useMemo(() => {
    const rawNodes = (graphData && Array.isArray(graphData.nodes)) ? graphData.nodes : [];
    const rawLinks = (graphData && Array.isArray(graphData.links))
      ? graphData.links
      : ((graphData as any) && Array.isArray((graphData as any).edges))
      ? (graphData as any).edges.map((e: any) => ({ source: e.from, target: e.to, label: e.label }))
      : [];

    const nodesById = new Map<string, any>(rawNodes.map((n: any) => [n.id, n]));

    const phraseNodes = rawNodes.filter((n: any) => n.group === 'Phrase');
    const buyers: Array<{
      id: string;
      phraseId: string;
      rawPhraseText: string;
      conceptName: string;
      attachedClasses: Array<{ code?: string; title: string }>;
    }> = [];

    for (const p of phraseNodes) {
      const phraseText = sanitizeNodeName((p as any).label || p.name || (p as any).title || p.id);
      let conceptName = '';
      const attachedClasses: Array<{ code?: string; title: string }> = [];

      for (const l of rawLinks) {
        const srcId = typeof l.source === 'object' ? (l.source as any).id : l.source;
        const tgtId = typeof l.target === 'object' ? (l.target as any).id : l.target;

        if (srcId === p.id && l.label === 'EXTRACTS_CONCEPT') {
          const conceptNode = nodesById.get(tgtId);
          if (conceptNode) {
            conceptName = sanitizeNodeName((conceptNode as any).label || conceptNode.name || conceptNode.id);
            for (const cl of rawLinks) {
              const cSrc = typeof cl.source === 'object' ? (cl.source as any).id : cl.source;
              const cTgt = typeof cl.target === 'object' ? (cl.target as any).id : cl.target;
              if (cSrc === conceptNode.id && cl.label === 'MAPPED_TO_GPC') {
                const classNode = nodesById.get(cTgt);
                if (classNode) {
                  const classTitle = sanitizeNodeName((classNode as any).label || classNode.name || (classNode as any).title || classNode.id);
                  if (!attachedClasses.some((c) => c.title === classTitle)) {
                    attachedClasses.push({
                      code: (classNode as any).code || ((classNode as any).properties && (classNode as any).properties.code),
                      title: classTitle,
                    });
                  }
                }
              }
            }
          }
        }
      }

      buyers.push({
        id: p.id,
        phraseId: p.id,
        rawPhraseText: phraseText,
        conceptName: conceptName || 'Product Search',
        attachedClasses,
      });
    }

    if (panelSearch.trim()) {
      const q = panelSearch.toLowerCase();
      return buyers.filter(
        (b) =>
          b.rawPhraseText.toLowerCase().includes(q) ||
          b.conceptName.toLowerCase().includes(q) ||
          b.attachedClasses.some((c) => c.title.toLowerCase().includes(q))
      );
    }

    return buyers;
  }, [graphData, panelSearch]);

  // Filtered graph dataset based on View Perspective (Classes, Families, Segments, Vendors, Buyers)
  const filteredData = useMemo(() => {
    const rawNodes = (graphData && Array.isArray(graphData.nodes)) ? graphData.nodes : [];
    const rawLinks = (graphData && Array.isArray(graphData.links))
      ? graphData.links
      : ((graphData as any) && Array.isArray((graphData as any).edges))
      ? (graphData as any).edges.map((e: any) => ({
          source: e.from,
          target: e.to,
          label: e.label,
          score: e.score,
        }))
      : [];

    let nodes: any[] = [];
    let links: any[] = [];

    if (viewPerspective === 'class_cluster') {
      // Perspective A: Clean Classes View (GpcClass + Concept + Vendor/Actor + Buyer)
      nodes = rawNodes.filter((n: any) =>
        ['GpcClass', 'Concept', 'Actor', 'Vendor', 'SELLER', 'BUYER'].includes(String(n.group))
      ).map((n: any) => ({
        ...n,
        name: sanitizeNodeName((n as any).label || n.name || ((n as any).properties && (n as any).properties.title) || (n as any).title || n.id),
        group: n.group || 'Node',
      }));

      const nodeIds = new Set(nodes.map((n) => n.id));
      links = rawLinks.filter(
        (l: any) =>
          l &&
          ['MAPPED_TO_GPC', 'SUPPLIES_GPC_CLASS', 'SUPPLIES', 'REQUESTS'].includes(l.label) &&
          nodeIds.has(typeof l.source === 'object' ? (l.source as any).id : l.source) &&
          nodeIds.has(typeof l.target === 'object' ? (l.target as any).id : l.target)
      );
    } else if (viewPerspective === 'family_view') {
      // Perspective B: Families + Vendor nodes connected to Families
      const familyNodesMap = new Map<string, any>();
      const vendorNodesMap = new Map<string, any>();
      const classToFamilyMap = new Map<string, string>();
      const familyLinksMap = new Map<string, any>();

      for (const n of rawNodes) {
        const gStr = String(n.group);
        if (gStr === 'GpcFamily') {
          familyNodesMap.set(n.id, {
            ...n,
            name: sanitizeNodeName((n as any).label || n.name || ((n as any).properties && (n as any).properties.title) || (n as any).title || n.id),
          });
        } else if (['Actor', 'Vendor', 'SELLER', 'BUYER'].includes(gStr)) {
          vendorNodesMap.set(n.id, {
            ...n,
            name: sanitizeNodeName((n as any).label || n.name || ((n as any).properties && (n as any).properties.title) || (n as any).title || n.id),
          });
        }
      }

      for (const l of rawLinks) {
        const srcId = typeof l.source === 'object' ? (l.source as any).id : l.source;
        const tgtId = typeof l.target === 'object' ? (l.target as any).id : l.target;
        if (l.label === 'BELONGS_TO_FAMILY') {
          classToFamilyMap.set(srcId, tgtId);
        }
      }

      for (const l of rawLinks) {
        const srcId = typeof l.source === 'object' ? (l.source as any).id : l.source;
        const tgtId = typeof l.target === 'object' ? (l.target as any).id : l.target;

        if (l.label === 'SUPPLIES_GPC_CLASS') {
          const familyId = classToFamilyMap.get(tgtId);
          if (familyId && familyNodesMap.has(familyId) && vendorNodesMap.has(srcId)) {
            const edgeKey = `${srcId}->${familyId}`;
            if (!familyLinksMap.has(edgeKey)) {
              familyLinksMap.set(edgeKey, {
                source: srcId,
                target: familyId,
                label: 'SUPPLIES_FAMILY',
                value: 3,
              });
            }
          }
        }
      }

      nodes = [...Array.from(familyNodesMap.values()), ...Array.from(vendorNodesMap.values())];
      links = Array.from(familyLinksMap.values());

      if (links.length === 0) {
        const nodeIds = new Set(nodes.map((n) => n.id));
        links = rawLinks.filter(
          (l: any) =>
            l &&
            nodeIds.has(typeof l.source === 'object' ? (l.source as any).id : l.source) &&
            nodeIds.has(typeof l.target === 'object' ? (l.target as any).id : l.target)
        );
      }
    } else if (viewPerspective === 'segment_view') {
      // Perspective C: Segments
      nodes = rawNodes.filter((n: any) => String(n.group) === 'GpcSegment').map((n: any) => ({
        ...n,
        name: sanitizeNodeName((n as any).label || n.name || ((n as any).properties && (n as any).properties.title) || (n as any).title || n.id),
      }));
      const segmentNodeIds = new Set(nodes.map((n) => n.id));
      links = rawLinks.filter(
        (l: any) =>
          l &&
          segmentNodeIds.has(typeof l.source === 'object' ? (l.source as any).id : l.source) &&
          segmentNodeIds.has(typeof l.target === 'object' ? (l.target as any).id : l.target)
      );
    } else if (viewPerspective === 'vendors') {
      // Perspective D: Vendors + Supplied GPC Classes
      const vendorNodesMap = new Map<string, any>();
      const suppliedClassIds = new Set<string>();

      for (const n of rawNodes) {
        const gStr = String(n.group);
        const isVendorNode =
          gStr === 'Actor' ||
          gStr === 'Vendor' ||
          gStr === 'SELLER' ||
          String(n.id).startsWith('seller_') ||
          ((n as any).properties && (n as any).properties.type === 'SELLER');
        if (isVendorNode) {
          vendorNodesMap.set(n.id, {
            ...n,
            name: sanitizeNodeName((n as any).label || n.name || ((n as any).properties && (n as any).properties.name) || (n as any).title || n.id),
          });
        }
      }

      for (const l of rawLinks) {
        const srcId = typeof l.source === 'object' ? (l.source as any).id : l.source;
        const tgtId = typeof l.target === 'object' ? (l.target as any).id : l.target;
        if (vendorNodesMap.has(srcId) && l.label === 'SUPPLIES_GPC_CLASS') {
          suppliedClassIds.add(tgtId);
        }
      }

      const gpcClassNodes = rawNodes.filter((n: any) => String(n.group) === 'GpcClass' && suppliedClassIds.has(n.id)).map((n: any) => ({
        ...n,
        name: sanitizeNodeName((n as any).label || n.name || ((n as any).properties && (n as any).properties.title) || (n as any).title || n.id),
      }));

      nodes = [...Array.from(vendorNodesMap.values()), ...gpcClassNodes];
      const activeIds = new Set(nodes.map((n) => n.id));
      links = rawLinks.filter(
        (l: any) =>
          l &&
          l.label === 'SUPPLIES_GPC_CLASS' &&
          activeIds.has(typeof l.source === 'object' ? (l.source as any).id : l.source) &&
          activeIds.has(typeof l.target === 'object' ? (l.target as any).id : l.target)
      );
    } else if (viewPerspective === 'buyers') {
      // Perspective E: Buyers, Phrases, Concepts + Attached GPC Classes
      nodes = rawNodes.filter((n: any) => {
        const gStr = String(n.group);
        return (
          ['Phrase', 'Concept', 'BUYER'].includes(gStr) ||
          (gStr === 'Actor' && ((n as any).properties?.type === 'BUYER' || String(n.id).startsWith('buyer_'))) ||
          gStr === 'GpcClass'
        );
      }).map((n: any) => ({
        ...n,
        name: sanitizeNodeName((n as any).label || n.name || ((n as any).properties && (n as any).properties.title) || (n as any).title || n.id),
      }));

      const activeIds = new Set(nodes.map((n) => n.id));
      links = rawLinks.filter(
        (l: any) =>
          l &&
          ['EXTRACTS_CONCEPT', 'MAPPED_TO_GPC'].includes(l.label) &&
          activeIds.has(typeof l.source === 'object' ? (l.source as any).id : l.source) &&
          activeIds.has(typeof l.target === 'object' ? (l.target as any).id : l.target)
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      nodes = nodes.filter(
        (n: any) =>
          (n.name && String(n.name).toLowerCase().includes(q)) ||
          (n.label && String(n.label).toLowerCase().includes(q)) ||
          (n.title && String(n.title).toLowerCase().includes(q)) ||
          (n.code && String(n.code).toLowerCase().includes(q)) ||
          (n.id && String(n.id).toLowerCase().includes(q))
      );
      const activeIds = new Set(nodes.map((n) => n.id));
      links = links.filter(
        (l: any) =>
          activeIds.has(typeof l.source === 'object' ? (l.source as any).id : l.source) &&
          activeIds.has(typeof l.target === 'object' ? (l.target as any).id : l.target)
      );
    }

    return { nodes, links };
  }, [graphData, searchQuery, viewPerspective]);

  return (
    <div className="relative w-full h-[calc(100vh-80px)] rounded-3xl bg-background border border-surface-border overflow-hidden flex flex-col">
      {/* Top Toolbar */}
      <div className="absolute top-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 p-3 bg-surface/85 backdrop-blur-md rounded-2xl border border-surface-border shadow-xl">
        {/* Search */}
        <div className="flex items-center space-x-2 bg-background px-3 py-1.5 rounded-xl border border-surface-border focus-within:border-purple-500 w-56">
          <Search className="w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search concepts, stores..."
            className="bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none w-full"
          />
        </div>

        {/* Interactive 5-Perspective Tab Switcher */}
        <div className="flex items-center p-1 rounded-xl bg-background/90 border border-surface-border text-xs gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setViewPerspective('class_cluster')}
            className={`px-3 py-1.5 rounded-lg font-extrabold text-xs transition-all ${
              viewPerspective === 'class_cluster'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Classes
          </button>
          <button
            type="button"
            onClick={() => setViewPerspective('family_view')}
            className={`px-3 py-1.5 rounded-lg font-extrabold text-xs transition-all ${
              viewPerspective === 'family_view'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Families
          </button>
          <button
            type="button"
            onClick={() => setViewPerspective('segment_view')}
            className={`px-3 py-1.5 rounded-lg font-extrabold text-xs transition-all ${
              viewPerspective === 'segment_view'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Segments
          </button>
          <button
            type="button"
            onClick={() => {
              setViewPerspective('vendors');
              setIsPanelOpen(true);
            }}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg font-extrabold text-xs transition-all ${
              viewPerspective === 'vendors'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Store className="w-3.5 h-3.5" />
            <span>Vendors</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setViewPerspective('buyers');
              setIsPanelOpen(true);
            }}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg font-extrabold text-xs transition-all ${
              viewPerspective === 'buyers'
                ? 'bg-cyan-600 text-white shadow-md shadow-cyan-500/20 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>Buyers</span>
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={fetchGraph}
            disabled={isLoading}
            className="p-2 rounded-xl bg-surface-light border border-surface-border text-slate-300 hover:text-white transition-all active:scale-95"
            title="Refresh Graph"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-purple-400' : ''}`} />
          </button>
          <button
            onClick={() => graphRef.current?.zoomToFit(400, 30)}
            className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition-all shadow-md shadow-purple-500/20 active:scale-95"
          >
            Zoom to Fit
          </button>
        </div>
      </div>

      {/* Hover Link Tooltip */}
      {hoveredLink && (
        <div className="absolute bottom-4 left-4 z-20 p-3 bg-surface/90 border border-purple-500/50 backdrop-blur-md rounded-2xl shadow-xl animate-in fade-in text-xs">
          <span className="text-[10px] text-purple-300 font-mono uppercase font-bold block mb-1">
            Edge: {hoveredLink.label || 'LINK'}
          </span>
        </div>
      )}

      {/* Main Canvas & Overlay Panel */}
      <div className="flex-1 w-full h-full relative">
        <ForceGraph2D
          ref={graphRef}
          graphData={filteredData}
          nodeLabel={(node: any) => node.name || node.label || node.id}
          nodeColor={(node: any) => {
            if (node.color) return node.color;
            if (node.group === 'GpcClass') return '#f59e0b';
            if (node.group === 'GpcFamily') return '#3b82f6';
            if (node.group === 'GpcSegment') return '#6366f1';
            if (node.group === 'Concept') return '#a855f7';
            if (node.group === 'Phrase') return '#06b6d4';
            if (node.group === 'Actor' || node.group === 'Vendor' || node.group === 'SELLER') return '#10b981';
            if (node.group === 'BUYER') return '#ec4899';
            return '#a855f7';
          }}
          nodeVal={(node: any) => {
            if (node.group === 'GpcClass') return 24;
            if (node.group === 'GpcFamily') return 28;
            if (node.group === 'GpcSegment') return 32;
            if (node.group === 'Actor' || node.group === 'Vendor' || node.group === 'SELLER') return 26;
            return node.val || 18;
          }}
          linkColor={() => 'rgba(148, 163, 184, 0.35)'}
          linkWidth={(link: any) => (link.label === 'SUPPLIES_GPC_CLASS' || link.label === 'MAPPED_TO_GPC' || link.label === 'EXTRACTS_CONCEPT' ? 2.5 : 1.5)}
          linkHoverPrecision={6}
          onLinkHover={(link: any) => setHoveredLink(link || null)}
          onNodeClick={(node: any) => setSelectedNode(node)}
          cooldownTicks={100}
          nodeCanvasObjectMode={() => 'after'}
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const label = node.name || node.label || '';
            const fontSize = Math.max(10 / globalScale, 3.5);
            ctx.font = `${fontSize}px Inter, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle =
              node.group === 'GpcClass'
                ? '#fde68a'
                : node.group === 'GpcFamily'
                ? '#93c5fd'
                : node.group === 'Actor' || node.group === 'Vendor' || node.group === 'SELLER'
                ? '#6ee7b7'
                : node.group === 'Phrase'
                ? '#67e8f9'
                : '#e9d5ff';
            ctx.fillText(label, node.x, node.y + (node.val || 16) + 2);
          }}
          backgroundColor="#090d16"
        />

        {/* Dedicated Inspector Cards Panel for Vendors & Buyers */}
        {(viewPerspective === 'vendors' || viewPerspective === 'buyers') && isPanelOpen && (
          <div className="absolute top-20 right-4 bottom-4 w-96 z-30 bg-[#0f172a]/90 backdrop-blur-xl border border-slate-700/60 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Panel Header */}
            <div className="p-3.5 border-b border-slate-700/60 flex items-center justify-between bg-slate-900/60">
              <div className="flex items-center gap-2">
                {viewPerspective === 'vendors' ? (
                  <Store className="w-4 h-4 text-emerald-400" />
                ) : (
                  <ShoppingBag className="w-4 h-4 text-cyan-400" />
                )}
                <span className="font-bold text-sm text-slate-100">
                  {viewPerspective === 'vendors' ? 'Verified Vendor Stores' : 'Buyer Searches & Concepts'}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-800 text-slate-300 border border-slate-700">
                  {viewPerspective === 'vendors' ? vendorListSummary.length : buyerListSummary.length}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setIsPanelOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Panel Search Filter */}
            <div className="p-3 border-b border-slate-700/60 bg-slate-950/40">
              <div className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-700/80">
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  value={panelSearch}
                  onChange={(e) => setPanelSearch(e.target.value)}
                  placeholder={viewPerspective === 'vendors' ? 'Filter stores, categories...' : 'Filter queries, concepts...'}
                  className="bg-transparent text-xs text-slate-200 placeholder-slate-500 focus:outline-none w-full"
                />
              </div>
            </div>

            {/* Scrollable Card List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
              {viewPerspective === 'vendors' && (
                <>
                  {vendorListSummary.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-xs">
                      No vendor stores found. Register a vendor in the chat to see attached GPC Class clusters!
                    </div>
                  ) : (
                    vendorListSummary.map((v) => (
                      <div
                        key={v.id}
                        onClick={() => focusOnNode(v.id)}
                        className="p-3.5 rounded-xl bg-slate-900/80 hover:bg-slate-800/90 border border-slate-700/60 hover:border-emerald-500/50 cursor-pointer transition-all space-y-2.5 group shadow-sm"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
                              <Store className="w-3.5 h-3.5" />
                            </div>
                            <div>
                              <h4 className="font-bold text-xs text-slate-100 group-hover:text-emerald-300 transition-colors">
                                {v.name}
                              </h4>
                              <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                                <span className="flex items-center gap-1">
                                  <MapPin className="w-3 h-3 text-slate-500" /> {v.location}
                                </span>
                              </div>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all" />
                        </div>

                        {/* Attached GPC Class Clusters */}
                        <div className="pt-2 border-t border-slate-800">
                          <span className="text-[10px] font-bold text-slate-400 block mb-1.5 uppercase tracking-wider">
                            Attached GPC Class Clusters ({v.attachedClasses.length})
                          </span>
                          {v.attachedClasses.length === 0 ? (
                            <span className="text-[11px] text-slate-500 italic">No GPC classes linked yet</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {v.attachedClasses.map((c, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                >
                                  <Tag className="w-2.5 h-2.5" />
                                  {c.title}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}

              {viewPerspective === 'buyers' && (
                <>
                  {buyerListSummary.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-xs">
                      No buyer searches found. Perform a buyer search in the chat to view created phrases and concepts!
                    </div>
                  ) : (
                    buyerListSummary.map((b) => (
                      <div
                        key={b.id}
                        onClick={() => focusOnNode(b.id)}
                        className="p-3.5 rounded-xl bg-slate-900/80 hover:bg-slate-800/90 border border-slate-700/60 hover:border-cyan-500/50 cursor-pointer transition-all space-y-2.5 group shadow-sm"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-xs">
                              <MessageSquare className="w-3.5 h-3.5" />
                            </div>
                            <div className="flex-1">
                              <h4 className="font-bold text-xs text-slate-100 group-hover:text-cyan-300 transition-colors line-clamp-1">
                                &quot;{b.rawPhraseText}&quot;
                              </h4>
                              <span className="text-[10px] text-purple-400 font-semibold flex items-center gap-1 mt-0.5">
                                <Sparkles className="w-3 h-3 text-purple-400" /> Concept: {b.conceptName}
                              </span>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all shrink-0" />
                        </div>

                        {/* Resolved GPC Class Cluster */}
                        <div className="pt-2 border-t border-slate-800">
                          <span className="text-[10px] font-bold text-slate-400 block mb-1.5 uppercase tracking-wider">
                            Resolved GPC Class Cluster
                          </span>
                          {b.attachedClasses.length === 0 ? (
                            <span className="text-[11px] text-slate-500 italic">No GPC class resolved</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {b.attachedClasses.map((c, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                >
                                  <Tag className="w-2.5 h-2.5" />
                                  {c.title}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Node Detail Modal */}
      <NodeDetailModal
        node={selectedNode}
        allNodes={graphData.nodes}
        allLinks={graphData.links}
        onClose={() => setSelectedNode(null)}
      />
    </div>
  );
};
