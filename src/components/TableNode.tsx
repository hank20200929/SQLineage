import { Handle, Position } from '@xyflow/react';
import { Table } from '../types';
import { Database, Table as TableIcon, LayoutTemplate } from 'lucide-react';
import { cn } from '../utils/cn';

export default function TableNode({ data, selected }: { data: Table, selected?: boolean }) {
  const isSource = data.type === 'SOURCE';
  const isTarget = data.type === 'TARGET';
  const isIntermediate = data.type === 'INTERMEDIATE';

  const isDimmed = data.dimmed;

  const typeLabel = {
    SOURCE: '数据源',
    INTERMEDIATE: '中间表',
    TARGET: '目标表'
  }[data.type] || data.type;

  return (
    <div className={cn(
      "w-[280px] rounded-lg border bg-white shadow-sm overflow-hidden font-sans transition-all duration-200",
      isSource && "border-blue-200",
      isTarget && "border-emerald-200",
      isIntermediate && "border-amber-200",
      selected && "ring-2 ring-indigo-500 shadow-md",
      isDimmed && "opacity-40 grayscale-[50%]"
    )}>
      {/* Header */}
      <div className={cn(
        "relative flex flex-col gap-1 px-3 py-2 border-b",
        isSource && "bg-blue-50 border-blue-100 text-blue-900",
        isTarget && "bg-emerald-50 border-emerald-100 text-emerald-900",
        isIntermediate && "bg-amber-50 border-amber-100 text-amber-900"
      )}>
        {/* Table-level handles for fallback connectivity */}
        <Handle
          type="target"
          position={Position.Left}
          id="table-target"
          className="w-2 h-2 !bg-transparent border-none -ml-[5px]"
        />
        <Handle
          type="source"
          position={Position.Right}
          id="table-source"
          className="w-2 h-2 !bg-transparent border-none -mr-[5px]"
        />

        <div className="flex items-center gap-2">
          {isSource && <Database className="w-4 h-4 text-blue-500 shrink-0" />}
          {isTarget && <LayoutTemplate className="w-4 h-4 text-emerald-500 shrink-0" />}
          {isIntermediate && <TableIcon className="w-4 h-4 text-amber-500 shrink-0" />}
          <div className="flex flex-col overflow-hidden">
            <span className="text-xs font-semibold truncate" title={data.name}>{data.name === 'Result Set' ? '最终结果' : data.name}</span>
            <span className="text-[10px] opacity-70 uppercase tracking-wider">{typeLabel}</span>
          </div>
        </div>
        {data.description && (
          <div className="text-[10px] opacity-80 mt-1 pl-6 leading-tight border-l-2 border-current ml-1">
            {data.description}
          </div>
        )}
      </div>

      {/* Columns */}
      <div className="flex flex-col py-1 bg-white">
        {data.columns.map((col) => {
          const isHighlighted = data.highlightedColumns?.includes(col.id);
          return (
            <div 
              key={col.id} 
              className={cn(
                "relative flex flex-col px-3 py-1.5 hover:bg-gray-50 group cursor-pointer transition-colors",
                isHighlighted && "bg-indigo-50 hover:bg-indigo-100"
              )}
              onClick={(e) => {
                e.stopPropagation();
                data.onColumnClick?.(data.id, col.id);
              }}
            >
              <div className="flex items-center w-full">
                {/* Left Handle (Target) */}
                <Handle
                  type="target"
                  position={Position.Left}
                  id={col.id}
                  className={cn(
                    "w-2 h-2 !bg-gray-300 border-none -ml-[5px] group-hover:!bg-blue-400 transition-colors",
                    isHighlighted && "!bg-indigo-500"
                  )}
                />
                
                <span className={cn(
                  "text-xs text-gray-700 font-mono truncate flex-1",
                  isHighlighted && "text-indigo-700 font-semibold"
                )} title={col.name}>
                  {col.name}
                </span>

                {/* Right Handle (Source) */}
                <Handle
                  type="source"
                  position={Position.Right}
                  id={col.id}
                  className={cn(
                    "w-2 h-2 !bg-gray-300 border-none -mr-[5px] group-hover:!bg-blue-400 transition-colors",
                    isHighlighted && "!bg-indigo-500"
                  )}
                />
              </div>
              {col.description && (
                <div className={cn(
                  "text-[10px] text-gray-400 mt-0.5 pl-2 truncate",
                  isHighlighted && "text-indigo-500"
                )} title={col.description}>
                  <span className={cn("text-gray-300 mr-1", isHighlighted && "text-indigo-300")}>└</span>
                  {col.description}
                </div>
              )}
            </div>
          );
        })}
        {data.columns.length === 0 && (
          <div className="px-3 py-2 text-xs text-gray-400 italic text-center">
            No columns
          </div>
        )}
      </div>
    </div>
  );
}
