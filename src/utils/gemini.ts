import { GoogleGenAI, Type } from '@google/genai';
import { LineageData } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function analyzeSqlLineage(sql: string): Promise<LineageData> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `You are an expert SQL parser and data lineage analyzer.
    Analyze the following SQL query and extract the EXHAUSTIVE data lineage at both the table and column level.
    
    Identify ALL source tables, ALL intermediate tables/views/CTEs/subqueries, and the final target table or result set.
    If the query is a SELECT statement without an explicit target table, create a TARGET table named '最终结果'.
    
    CRITICAL: Exhaustive Column-Level Lineage
    - EVERY column in the SELECT clause of EVERY subquery, CTE, and final query MUST be traced back to its source.
    - You MUST create an edge for EVERY single column mapping. Do not group them. Do not skip any.
    - If a column is passed through multiple intermediate tables (e.g., Source -> CTE1 -> CTE2 -> Target), you MUST create edges for EVERY step (Source->CTE1, CTE1->CTE2, CTE2->Target).
    - If a column is derived from multiple source columns (e.g., a + b AS c), you MUST create multiple edges (a->c and b->c).

    CRITICAL: Aggregations, Filters, and Transformations (IN CHINESE)
    - You MUST explicitly state the aggregation method (e.g., "SUM()", "COUNT()", "MAX()", "GROUP BY") in the column \`description\` (NOT the edge description). Translate these to Chinese (e.g., "求和(SUM)", "计数(COUNT)").
    - You MUST extract and include specific filter conditions (e.g., "WHERE status = 'ACTIVE'") that apply to specific columns or tables in their descriptions.
    - Keep edge descriptions empty or extremely brief. Do not clutter edges with formulas.

    CRITICAL: Comprehensive Lineage (No Missing Links or Tables)
    - You MUST NOT lose ANY intermediate subquery tables, CTEs (Common Table Expressions), or derived tables. EVERY step of the data transformation MUST be represented as an INTERMEDIATE table.
    - If there is a subquery inside a FROM or JOIN clause, it MUST be extracted as an INTERMEDIATE table.

    CRITICAL: UNION and UNION ALL Queries
    - You MUST extract lineage for EVERY branch of a UNION or UNION ALL.
    - All source tables from all SELECT statements within the UNION must be identified and linked to the target table/result set.
    - Do not miss any tables or columns that are part of a UNION.

    CRITICAL: Extract and include comments/descriptions from the SQL! (MUST BE 100% CHINESE)
    - If a table has an alias or a comment (e.g., "-- User table"), include it in the table's description.
    - If a column has a comment (e.g., "id -- user ID"), include it in the column's description.
    - Extract any global filter conditions (WHERE clauses) into the metadata filters array.
    - IMPORTANT: ALL extracted comments, descriptions, annotations, aggregations, and logic MUST be translated to Chinese (简体中文). DO NOT output any English descriptions.

    CRITICAL: Graph Connectivity (Prevent Broken Links)
    - EVERY sourceTableId and targetTableId in the edges array MUST exactly match an id of a table in the tables array.
    - EVERY sourceColumnId and targetColumnId in the edges array MUST exactly match an id of a column within the corresponding table.
    - Do not create edges to tables or columns that are not explicitly defined in the tables array. If you need to create an edge, you MUST create the corresponding table and column first.
    
    SQL Query:
    ${sql}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          metadata: {
            type: Type.OBJECT,
            properties: {
              moduleName: { type: Type.STRING, description: "Overall module name or description from top-level comments" },
              filters: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of global filter conditions (e.g., WHERE clauses)"
              }
            }
          },
          tables: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: "Unique identifier for the table (e.g., 't1', 'users')" },
                name: { type: Type.STRING, description: "Name of the table" },
                type: { type: Type.STRING, description: "Must be 'SOURCE', 'TARGET', or 'INTERMEDIATE'" },
                description: { type: Type.STRING, description: "Table comment, alias, or description" },
                columns: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING, description: "Unique identifier for the column within the table (e.g., 't1_col1')" },
                      name: { type: Type.STRING, description: "Name of the column" },
                      description: { type: Type.STRING, description: "Column comment or description" }
                    },
                    required: ["id", "name"]
                  }
                }
              },
              required: ["id", "name", "type", "columns"]
            }
          },
          edges: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: "Unique identifier for the edge" },
                sourceTableId: { type: Type.STRING },
                sourceColumnId: { type: Type.STRING },
                targetTableId: { type: Type.STRING },
                targetColumnId: { type: Type.STRING },
                description: { type: Type.STRING, description: "Transformation logic, join condition, or formula" }
              },
              required: ["id", "sourceTableId", "sourceColumnId", "targetTableId", "targetColumnId"]
            }
          }
        },
        required: ["tables", "edges"]
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No response from Gemini");
  return JSON.parse(text) as LineageData;
}
