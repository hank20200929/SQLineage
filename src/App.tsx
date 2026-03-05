/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useCallback, useEffect, useMemo, UIEvent } from 'react';
import { ReactFlow, Background, Controls, MiniMap, Node, Edge, useNodesState, useEdgesState, ConnectionLineType, MarkerType, ReactFlowProvider, useReactFlow, Panel, getNodesBounds, getViewportForBounds } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { analyzeSqlLineage } from './utils/gemini';
import { getLayoutedElements } from './utils/layout';
import TableNode from './components/TableNode';
import { Play, Loader2, DatabaseZap, AlertCircle, Filter, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, RotateCcw, Download } from 'lucide-react';
import { LineageData } from './types';
import { toPng } from 'html-to-image';
import { cn } from './utils/cn';

const initialSql = `-- Module: Sales Reporting
-- This query generates the regional sales summary for completed orders.

INSERT INTO sales_summary (region, total_sales, order_count)
SELECT 
  c.region, -- Customer's region
  SUM(o.amount) as total_sales, -- Total sales amount in USD
  COUNT(o.order_id) as order_count -- Number of valid orders
FROM orders o -- Orders transaction table
JOIN customers c ON o.customer_id = c.id -- Link to get customer region
WHERE o.status = 'COMPLETED' -- Only include completed orders
GROUP BY c.region;`;

const nodeTypes = {
  tableNode: TableNode,
};

type HighlightState = {
  type: 'node' | 'column' | 'edge' | null;
  nodeId: string | null;
  columnId: string | null;
  edgeId: string | null;
};

function FlowApp() {
  const [sql, setSql] = useState(initialSql);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisTime, setAnalysisTime] = useState<number | null>(null);
  const [metadata, setMetadata] = useState<LineageData['metadata']>();
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isFiltersOpen, setIsFiltersOpen] = useState(true);
  
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [originalLayout, setOriginalLayout] = useState<{nodes: Node[], edges: Edge[]}>({nodes: [], edges: []});
  
  const [highlightState, setHighlightState] = useState<HighlightState>({ type: null, nodeId: null, columnId: null, edgeId: null });

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const { fitView, getNodes } = useReactFlow();

  const handleColumnClick = useCallback((tableId: string, columnId: string) => {
    setHighlightState({ type: 'column', nodeId: tableId, columnId, edgeId: null });
  }, []);

  const handleNodeClick = useCallback((_: any, node: Node) => {
    setHighlightState({ type: 'node', nodeId: node.id, columnId: null, edgeId: null });
  }, []);

  const handleEdgeClick = useCallback((_: any, edge: Edge) => {
    setHighlightState({ type: 'edge', nodeId: null, columnId: null, edgeId: edge.id });
  }, []);

  const handlePaneClick = useCallback(() => {
    setHighlightState({ type: null, nodeId: null, columnId: null, edgeId: null });
  }, []);

  const highlightedKeywords = useMemo(() => {
    if (!highlightState.type || !originalLayout.nodes.length) return [];
    const keywords = new Set<string>();

    const addNodeKeywords = (nId: string) => {
      const node = originalLayout.nodes.find(n => n.id === nId);
      if (node && node.data.name !== 'Result Set' && node.data.name !== '最终结果') {
        keywords.add(node.data.name);
      }
      return node;
    };

    const addColumnKeywords = (node: any, cId: string) => {
      if (!node) return;
      const col = node.data.columns.find((c: any) => c.id === cId);
      if (col) {
        keywords.add(col.name);
      }
    };

    if (highlightState.type === 'node' && highlightState.nodeId) {
      addNodeKeywords(highlightState.nodeId);
    } else if (highlightState.type === 'column' && highlightState.nodeId && highlightState.columnId) {
      const node = addNodeKeywords(highlightState.nodeId);
      addColumnKeywords(node, highlightState.columnId);
    } else if (highlightState.type === 'edge' && highlightState.edgeId) {
      const edge = originalLayout.edges.find(e => e.id === highlightState.edgeId);
      if (edge) {
        const sNode = addNodeKeywords(edge.source);
        const tNode = addNodeKeywords(edge.target);
        if (edge.sourceHandle !== 'table-source') addColumnKeywords(sNode, edge.sourceHandle!);
        if (edge.targetHandle !== 'table-target') addColumnKeywords(tNode, edge.targetHandle!);
      }
    }

    return Array.from(keywords).filter(Boolean).sort((a, b) => b.length - a.length);
  }, [highlightState, originalLayout]);

  const renderHighlightedSql = () => {
    if (highlightedKeywords.length === 0 || !sql) {
      return <span className="text-transparent">{sql}</span>;
    }

    const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(${highlightedKeywords.map(escapeRegExp).join('|')})`, 'gi');
    
    const parts = sql.split(pattern);
    
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        return <mark key={i} className="bg-indigo-200/80 text-transparent rounded-sm">{part}</mark>;
      }
      return <span key={i} className="text-transparent">{part}</span>;
    });
  };

  const handleScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    if (backdropRef.current) {
      backdropRef.current.scrollTop = e.currentTarget.scrollTop;
      backdropRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  // Apply highlights whenever highlightState or originalLayout changes
  useEffect(() => {
    if (!originalLayout.nodes.length) return;

    if (highlightState.type === null) {
      // Reset highlights
      setNodes(nds => nds.map(n => ({
        ...n,
        data: { ...n.data, dimmed: false, highlightedColumns: [] }
      })));
      setEdges(eds => eds.map(e => ({
        ...e,
        style: { ...e.style, stroke: '#94a3b8', opacity: 1 },
        animated: true
      })));
      return;
    }

    const highlightedNodes = new Set<string>();
    const highlightedEdges = new Set<string>();
    const highlightedCols = new Set<string>();

    if (highlightState.type === 'node' && highlightState.nodeId) {
      // Downstream from node
      highlightedNodes.add(highlightState.nodeId);
      let added = true;
      while (added) {
        added = false;
        for (const edge of originalLayout.edges) {
          if (highlightedNodes.has(edge.source) && !highlightedNodes.has(edge.target)) {
            highlightedNodes.add(edge.target);
            highlightedEdges.add(edge.id);
            added = true;
          } else if (highlightedNodes.has(edge.source) && !highlightedEdges.has(edge.id)) {
            highlightedEdges.add(edge.id);
          }
        }
      }
    } else if (highlightState.type === 'column' && highlightState.nodeId && highlightState.columnId) {
      // Upstream from column
      const startKey = `${highlightState.nodeId}.${highlightState.columnId}`;
      highlightedCols.add(startKey);
      highlightedNodes.add(highlightState.nodeId);
      
      let added = true;
      while (added) {
        added = false;
        for (const edge of originalLayout.edges) {
          const targetKey = edge.targetHandle === 'table-target' ? edge.target : `${edge.target}.${edge.targetHandle}`;
          const sourceKey = edge.sourceHandle === 'table-source' ? edge.source : `${edge.source}.${edge.sourceHandle}`;
          
          const isTargetMatch = highlightedCols.has(targetKey) || (edge.targetHandle === 'table-target' && highlightedNodes.has(edge.target));
          
          if (isTargetMatch && !highlightedCols.has(sourceKey)) {
            highlightedCols.add(sourceKey);
            highlightedNodes.add(edge.source);
            highlightedEdges.add(edge.id);
            added = true;
          } else if (isTargetMatch && !highlightedEdges.has(edge.id)) {
            highlightedEdges.add(edge.id);
          }
        }
      }
    } else if (highlightState.type === 'edge' && highlightState.edgeId) {
      // Upstream and Downstream from edge
      highlightedEdges.add(highlightState.edgeId);
      const clickedEdge = originalLayout.edges.find(e => e.id === highlightState.edgeId);
      
      if (clickedEdge) {
        highlightedNodes.add(clickedEdge.source);
        highlightedNodes.add(clickedEdge.target);
        
        const sourceKey = clickedEdge.sourceHandle === 'table-source' ? clickedEdge.source : `${clickedEdge.source}.${clickedEdge.sourceHandle}`;
        const targetKey = clickedEdge.targetHandle === 'table-target' ? clickedEdge.target : `${clickedEdge.target}.${clickedEdge.targetHandle}`;
        
        highlightedCols.add(sourceKey);
        highlightedCols.add(targetKey);

        // Traverse upstream
        let added = true;
        while (added) {
          added = false;
          for (const edge of originalLayout.edges) {
            const tKey = edge.targetHandle === 'table-target' ? edge.target : `${edge.target}.${edge.targetHandle}`;
            const sKey = edge.sourceHandle === 'table-source' ? edge.source : `${edge.source}.${edge.sourceHandle}`;
            
            const isTargetMatch = highlightedCols.has(tKey) || (edge.targetHandle === 'table-target' && highlightedNodes.has(edge.target));
            
            if (isTargetMatch && !highlightedCols.has(sKey)) {
              highlightedCols.add(sKey);
              highlightedNodes.add(edge.source);
              highlightedEdges.add(edge.id);
              added = true;
            } else if (isTargetMatch && !highlightedEdges.has(edge.id)) {
              highlightedEdges.add(edge.id);
            }
          }
        }

        // Traverse downstream
        added = true;
        while (added) {
          added = false;
          for (const edge of originalLayout.edges) {
            const tKey = edge.targetHandle === 'table-target' ? edge.target : `${edge.target}.${edge.targetHandle}`;
            const sKey = edge.sourceHandle === 'table-source' ? edge.source : `${edge.source}.${edge.sourceHandle}`;
            
            const isSourceMatch = highlightedCols.has(sKey) || (edge.sourceHandle === 'table-source' && highlightedNodes.has(edge.source));
            
            if (isSourceMatch && !highlightedCols.has(tKey)) {
              highlightedCols.add(tKey);
              highlightedNodes.add(edge.target);
              highlightedEdges.add(edge.id);
              added = true;
            } else if (isSourceMatch && !highlightedEdges.has(edge.id)) {
              highlightedEdges.add(edge.id);
            }
          }
        }
      }
    }

    setNodes(nds => nds.map(n => {
      const isNodeHighlighted = highlightedNodes.has(n.id);
      const nodeCols = (n.data.columns as any[]).map(c => c.id);
      const hCols = nodeCols.filter(cId => highlightedCols.has(`${n.id}.${cId}`));
      
      return {
        ...n,
        data: { 
          ...n.data, 
          dimmed: !isNodeHighlighted,
          highlightedColumns: hCols
        }
      };
    }));

    setEdges(eds => eds.map(e => {
      const isEdgeHighlighted = highlightedEdges.has(e.id);
      return {
        ...e,
        style: { 
          ...e.style, 
          stroke: isEdgeHighlighted ? '#6366f1' : '#cbd5e1',
          strokeWidth: isEdgeHighlighted ? 3 : 2,
          opacity: isEdgeHighlighted ? 1 : 0.3
        },
        animated: isEdgeHighlighted,
        zIndex: isEdgeHighlighted ? 10 : 0
      };
    }));

  }, [highlightState, originalLayout, setNodes, setEdges]);

  const handleAnalyze = async () => {
    if (!sql.trim()) return;
    
    setIsAnalyzing(true);
    setError(null);
    setAnalysisTime(null);
    setHighlightState({ type: null, nodeId: null, columnId: null });
    
    const startTime = performance.now();
    try {
      const lineageData = await analyzeSqlLineage(sql);
      setMetadata(lineageData.metadata);
      
      // Convert to React Flow nodes and edges
      const initialNodes: Node[] = lineageData.tables.map(table => ({
        id: table.id,
        type: 'tableNode',
        position: { x: 0, y: 0 },
        data: { ...table, onColumnClick: handleColumnClick },
      }));

      const initialEdges: Edge[] = lineageData.edges
        .filter(edge => {
          const sourceTable = lineageData.tables.find(t => t.id === edge.sourceTableId);
          const targetTable = lineageData.tables.find(t => t.id === edge.targetTableId);
          return sourceTable && targetTable;
        })
        .map(edge => {
          const sourceTable = lineageData.tables.find(t => t.id === edge.sourceTableId);
          const targetTable = lineageData.tables.find(t => t.id === edge.targetTableId);
          
          const sourceColExists = sourceTable?.columns.some(c => c.id === edge.sourceColumnId);
          const targetColExists = targetTable?.columns.some(c => c.id === edge.targetColumnId);

          return {
            id: edge.id,
            source: edge.sourceTableId,
            sourceHandle: sourceColExists ? edge.sourceColumnId : 'table-source',
            target: edge.targetTableId,
            targetHandle: targetColExists ? edge.targetColumnId : 'table-target',
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#94a3b8', strokeWidth: 2 },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: '#94a3b8',
            },
          };
        });

      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        initialNodes,
        initialEdges,
        'LR'
      );

      setOriginalLayout({ nodes: layoutedNodes, edges: layoutedEdges });
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      
      setTimeout(() => {
        fitView({ padding: 0.2, duration: 800 });
      }, 100);
      
      const endTime = performance.now();
      setAnalysisTime(endTime - startTime);
      
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to analyze SQL lineage");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleResetLayout = () => {
    setHighlightState({ type: null, nodeId: null, columnId: null, edgeId: null });
    setNodes(originalLayout.nodes);
    setEdges(originalLayout.edges);
    setTimeout(() => {
      fitView({ padding: 0.2, duration: 800 });
    }, 50);
  };

  const handleExportPng = () => {
    if (reactFlowWrapper.current) {
      const flowElement = reactFlowWrapper.current.querySelector('.react-flow__viewport') as HTMLElement;
      if (flowElement) {
        const nodesBounds = getNodesBounds(getNodes());
        const padding = 100;
        const imageWidth = nodesBounds.width + padding * 2;
        const imageHeight = nodesBounds.height + padding * 2;
        
        // Use a fixed scale for high-quality export instead of calculating from viewport
        const exportScale = 3; 

        toPng(flowElement, { 
          backgroundColor: '#f8fafc',
          width: imageWidth,
          height: imageHeight,
          style: {
            width: imageWidth + 'px',
            height: imageHeight + 'px',
            transform: `translate(${-nodesBounds.x + padding}px, ${-nodesBounds.y + padding}px) scale(1)`,
          },
          pixelRatio: exportScale, // Ultra high resolution
          quality: 1,
          skipFonts: false,
          filter: (node) => {
            // Filter out UI elements like minimap or controls if they somehow get included
            if (node.classList?.contains('react-flow__minimap') || node.classList?.contains('react-flow__controls')) {
              return false;
            }
            return true;
          }
        })
        .then((dataUrl) => {
          const a = document.createElement('a');
          a.setAttribute('download', 'sql-lineage-hd.png');
          a.setAttribute('href', dataUrl);
          a.click();
        })
        .catch((err) => {
          console.error('Failed to export image', err);
        });
      }
    }
  };

  // Re-fit view when panel toggles
  useEffect(() => {
    setTimeout(() => {
      fitView({ padding: 0.2, duration: 500 });
    }, 300); // Wait for CSS transition
  }, [isPanelOpen, fitView]);

  return (
    <div className="flex h-screen w-full bg-gray-50 text-gray-900 font-sans overflow-hidden">
      {/* Left Panel - SQL Editor */}
      <div 
        className={cn(
          "flex flex-col bg-white shadow-sm z-10 transition-all duration-300 ease-in-out shrink-0 relative",
          isPanelOpen ? "w-1/3 min-w-[350px] max-w-[500px] border-r border-gray-200" : "w-0"
        )}
      >
        <div className={cn("flex flex-col h-full w-full overflow-hidden", !isPanelOpen && "hidden")}>
          <div className="p-4 border-b border-gray-100 flex items-center gap-2 bg-white min-w-[350px]">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
              <DatabaseZap className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-semibold text-gray-900 leading-tight">SQL Lineage</h1>
              <p className="text-xs text-gray-500">Analyze data flow from SQL queries</p>
            </div>
          </div>
          
          <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden min-w-[350px]">
            <label className="text-sm font-medium text-gray-700 flex justify-between items-center">
              SQL Query
              <span className="text-xs font-normal text-gray-400">PostgreSQL / MySQL / etc.</span>
            </label>
            <div className="relative flex-1 w-full rounded-lg border border-gray-200 bg-gray-50 overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500 transition-all">
              <div 
                ref={backdropRef}
                className="absolute inset-0 p-3 font-mono text-sm whitespace-pre-wrap break-words pointer-events-none overflow-y-auto overflow-x-hidden"
                aria-hidden="true"
              >
                {renderHighlightedSql()}
              </div>
              <textarea
                ref={textareaRef}
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                onScroll={handleScroll}
                className="absolute inset-0 w-full h-full p-3 font-mono text-sm bg-transparent resize-none outline-none text-gray-900 caret-black overflow-y-auto overflow-x-hidden"
                placeholder="Paste your SQL query here..."
                spellCheck={false}
              />
            </div>
            
            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-100 flex items-start gap-2 text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <p className="break-words">{error}</p>
              </div>
            )}

            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !sql.trim()}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors shadow-sm cursor-pointer disabled:cursor-not-allowed"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  Generate Lineage
                </>
              )}
            </button>
            
            {analysisTime !== null && !isAnalyzing && !error && (
              <div className="text-center text-xs text-gray-500 mt-1">
                分析用时: {(analysisTime / 1000).toFixed(2)} 秒
              </div>
            )}
          </div>
        </div>

        {/* Toggle Panel Button */}
        <button
          onClick={() => setIsPanelOpen(!isPanelOpen)}
          className="absolute -right-[28px] top-1/2 -translate-y-1/2 z-20 bg-white border border-gray-200 border-l-0 shadow-md rounded-r-lg p-1.5 hover:bg-gray-50 transition-all cursor-pointer"
        >
          {isPanelOpen ? <ChevronLeft className="w-4 h-4 text-gray-600" /> : <ChevronRight className="w-4 h-4 text-gray-600" />}
        </button>
      </div>

      {/* Right Panel - Graph */}
      <div className="flex-1 relative bg-[#f8fafc]" ref={reactFlowWrapper}>
        {nodes.length === 0 && !isAnalyzing && !error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 gap-4">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
              <DatabaseZap className="w-8 h-8 text-gray-300" />
            </div>
            <p className="text-sm">Enter a SQL query and click Generate Lineage</p>
          </div>
        ) : (
          <>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={handleNodeClick}
              onEdgeClick={handleEdgeClick}
              onPaneClick={handlePaneClick}
              nodeTypes={nodeTypes}
              connectionLineType={ConnectionLineType.SmoothStep}
              fitView
              className="bg-[#f8fafc]"
            >
              <Background color="#cbd5e1" gap={16} size={1} />
              <Controls className="bg-white border-gray-200 shadow-sm rounded-lg overflow-hidden" />
              
              <Panel position="top-right" className="flex gap-2">
                <button
                  onClick={handleResetLayout}
                  className="bg-white border border-gray-200 shadow-sm rounded-lg p-2 hover:bg-gray-50 transition-colors text-gray-600 flex items-center gap-2 text-sm font-medium cursor-pointer"
                  title="Reset Layout"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
                <button
                  onClick={handleExportPng}
                  className="bg-white border border-gray-200 shadow-sm rounded-lg p-2 hover:bg-gray-50 transition-colors text-gray-600 flex items-center gap-2 text-sm font-medium cursor-pointer"
                  title="Export as PNG"
                >
                  <Download className="w-4 h-4" />
                  Export
                </button>
              </Panel>

              <MiniMap 
                nodeStrokeColor={(n) => {
                  if (n.data?.type === 'SOURCE') return '#bfdbfe';
                  if (n.data?.type === 'TARGET') return '#a7f3d0';
                  if (n.data?.type === 'INTERMEDIATE') return '#fde68a';
                  return '#e2e8f0';
                }}
                nodeColor={(n) => {
                  if (n.data?.type === 'SOURCE') return '#eff6ff';
                  if (n.data?.type === 'TARGET') return '#ecfdf5';
                  if (n.data?.type === 'INTERMEDIATE') return '#fffbeb';
                  return '#f8fafc';
                }}
                maskColor="rgba(248, 250, 252, 0.7)"
                className="bg-white border-gray-200 shadow-sm rounded-lg"
              />
            </ReactFlow>

            {/* Metadata Overlay */}
            {metadata && metadata.filters && metadata.filters.length > 0 && (
              <div className={`absolute bottom-4 left-4 w-80 bg-white/90 backdrop-blur-sm border border-gray-200 shadow-sm rounded-lg flex flex-col pointer-events-auto z-10 transition-all duration-300 ${isFiltersOpen ? 'h-64' : 'h-12'}`}>
                <div 
                  className="flex items-center justify-between p-3 cursor-pointer border-b border-transparent hover:bg-gray-50/50 rounded-t-lg"
                  onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                >
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-amber-500 shrink-0" />
                    <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">全局过滤条件</h3>
                    <span className="bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                      {metadata.filters.length}
                    </span>
                  </div>
                  {isFiltersOpen ? (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronUp className="w-4 h-4 text-gray-400" />
                  )}
                </div>
                
                {isFiltersOpen && (
                  <div className="p-3 pt-0 overflow-y-auto flex-1">
                    <ul className="flex flex-col gap-1.5 w-full">
                      {metadata.filters.map((filter, i) => (
                        <li key={i} className="text-xs font-mono text-gray-700 bg-gray-100/80 px-2 py-1.5 rounded border border-gray-200/50 break-all whitespace-pre-wrap">
                          {filter}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <FlowApp />
    </ReactFlowProvider>
  );
}
