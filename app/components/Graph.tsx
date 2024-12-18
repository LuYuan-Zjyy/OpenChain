'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { message } from 'antd';

export interface Node extends d3.SimulationNodeDatum {
  id: string;
  group: number;
  type: 'user' | 'repo';
  nodeType: 'core' | 'extended' | 'center';
  metrics: {
    size: number;
    stars?: number;
    followers?: number;
  };
}

interface Link extends d3.SimulationLinkDatum<Node> {
  value: number;
  source: Node;
  target: Node;
}

interface GraphData {
  nodes: Node[];
  links: Link[];
  center: Node;
  status?: string;
  message?: string;
  recommendations?: Array<{
    name: string;
    metrics: {
      stars?: number;
      forks?: number;
      size?: number;
    };
    similarity: number;
  }>;
}

interface GraphProps {
  data: GraphData;
  onNodeClick: (node: Node) => void;
  selectedNode: Node | null;
  type: 'user' | 'repo';
}

const Graph: React.FC<GraphProps> = ({ data, onNodeClick, selectedNode, type }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [popupPosition, setPopupPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [error, setError] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // 请求 AI 分析
  const requestAnalysis = async (nodeA: string, nodeB: string) => {
    setIsLoading(true);
    setAiAnalysis('');
    
    try {
      console.log('Requesting analysis for:', nodeA, nodeB);
      const response = await fetch(`/api/analyze?node_a=${encodeURIComponent(nodeA)}&node_b=${encodeURIComponent(nodeB)}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Analysis response:', data);
      
      if (data.status === 'success' && data.analysis) {
        setAiAnalysis(data.analysis);
      } else {
        throw new Error(data.message || '分析失败，请稍后重试');
      }
    } catch (error) {
      console.error('Failed to get AI analysis:', error);
      setAiAnalysis(error instanceof Error ? error.message : '获取 AI 分析失败，请稍后重试');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current) return;

    // 检查是否有错误信息
    if (data.status === 'error') {
      message.error(data.message || '获取推荐数据失败');
      setError(data.message || '获取推荐数据失败');
      return;
    }

    setError(null);

    // 检查节点数据而不是 recommendations
    if (!data.nodes || data.nodes.length === 0) {
      message.warning('没有找到推荐结果');
      return;
    }

    // 获取容器的宽高和红框位置
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    setPopupPosition({
      left: rect.left - 60,
      top: rect.top - 260,
    });

    const width = container.clientWidth;
    const height = container.clientHeight;

    // 初始化 SVG
    const svg = d3.select(svgRef.current)
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', [0, 0, width, height].join(' '))
      .style('display', 'block')
      .style('background', 'transparent');

    svg.selectAll('*').remove();

    // 创建主绘图组
    const g = svg.append('g')
      .attr('width', width)
      .attr('height', height);

    // 缩放行为
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform.toString());
      });

    svg.call(zoom);

    // 计算节点半径
    const getNodeRadius = (d: Node) => {
      if (d.nodeType === 'center') return 45;
      if (d.nodeType === 'core') return 20 + Math.min(d.metrics.size, 20);
      return 10;  // 扩展节点使用较小的固定大小
    };

    // 获取节点颜色
    const getNodeColor = (d: Node) => {
      if (d.nodeType === 'center') return '#4169E1';
      if (d.nodeType === 'core') return '#90EE90';
      return '#FFD700';  // 扩展节点使用金色，像星星
    };

    // 获取文本颜色
    const getTextColor = (d: Node) => {
      if (d.id === data.center.id) return '#fff';  // 中心节点文本为白色
      return '#333';  // 其他节点文本为深灰色
    };

    // 力导向图配置
    const simulation = d3.forceSimulation<Node>(data.nodes)
      .force('link', d3.forceLink<Node, Link>(data.links)
        .id(d => d.id)
        .distance(link => {
          if ((link.source as Node).nodeType === 'extended' || 
              (link.target as Node).nodeType === 'extended') {
            return 100;  // 扩展节点使用较小的固定距离
          }
          const minDistance = 80;
          const maxDistance = 300;
          return minDistance + (1 - link.value) * (maxDistance - minDistance);
        }))
      .force('charge', d3.forceManyBody()
        .strength(d => {
          if (d.nodeType === 'center') return -1000;
          if (d.nodeType === 'core') return -400;
          return -100;  // 扩展节点使用较小的斥力
        }))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(0.1))
      .force('collision', d3.forceCollide()
        .radius(d => getNodeRadius(d) + 5)
        .strength(0.5))
      .force('radial', d3.forceRadial(
        d => d.id === data.center.id ? 0 : 150,
        width / 2,
        height / 2
      ).strength(0.3));

    // 绘制连接线
    const link = g.append('g')
      .selectAll('line')
      .data(data.links)
      .join('line')
      .attr('stroke', '#E5E5E5')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', 1);

    // 创建节点组
    const node = g.append('g')
      .selectAll<SVGGElement, Node>('g')
      .data(data.nodes)
      .join<SVGGElement>('g');

    // 拖拽行为
    const dragBehavior = d3.drag<SVGGElement, Node>()
      .on('start', (event) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        const d = event.subject;
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event) => {
        const d = event.subject;
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event) => {
        if (!event.active) simulation.alphaTarget(0);
        const d = event.subject;
        d.fx = null;
        d.fy = null;
      });

    node.call(dragBehavior);

    // 添加节点圆形
    node.append('circle')
      .attr('r', getNodeRadius)
      .attr('fill', getNodeColor)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .attr('opacity', d => d.nodeType === 'extended' ? 0.6 : 0.9);  // 扩展节点更透明

    // 添加文本标签
    node.append('text')
      .text(d => d.nodeType === 'extended' ? '' : d.id)  // 扩展节点不显示文本
      .attr('x', d => d.nodeType === 'center' ? 0 : 30)
      .attr('y', d => d.nodeType === 'center' ? 0 : 4)
      .attr('dominant-baseline', d => d.nodeType === 'center' ? 'middle' : 'auto')
      .attr('text-anchor', d => d.nodeType === 'center' ? 'middle' : 'start')
      .attr('font-size', d => d.nodeType === 'center' ? '14px' : '12px')
      .attr('fill', getTextColor)
      .attr('opacity', d => d.nodeType === 'extended' ? 0 : 0.8);

    // 更新位置
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as Node).x!)
        .attr('y1', d => (d.source as Node).y!)
        .attr('x2', d => (d.target as Node).x!)
        .attr('y2', d => (d.target as Node).y!);

      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // 修改点击事件处理
    node.on('click', async (event, d) => {
      event.stopPropagation();
      onNodeClick(d);
      
      // 如果点击的不是中心节点，请求 AI 分析
      if (d.id !== data.center.id) {
        await requestAnalysis(data.center.id, d.id);
      }
    });

    return () => {
      simulation.stop();
    };
  }, [data, onNodeClick]);

  // 如果有错误，显示错误信息
  if (error) {
    return (
      <div style={{ 
        width: '100%', 
        height: '400px', 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center',
        flexDirection: 'column',
        color: '#ff4d4f',
        backgroundColor: '#fff1f0',
        border: '1px solid #ffccc7',
        borderRadius: '4px',
        padding: '20px'
      }}>
        <h3 className="text-xl font-bold mb-4">推荐失败</h3>
        <div className="text-center">
          <p className="mb-2">{error}</p>
          <p className="text-sm text-gray-500">
            可能的原因：
            <ul className="list-disc text-left mt-2 ml-4">
              <li>GitHub API 访问限制</li>
              <li>网络连接问题</li>
              <li>用户或仓库不存在</li>
              <li>没有找到合适的推荐结果</li>
            </ul>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef} 
      style={{ 
        width: '100%', 
        height: 'calc(100vh - 6rem)',
        position: 'relative',
        background: 'transparent',
      }}
    >
      <svg 
        ref={svgRef}
        style={{ 
          width: '100%', 
          height: '100%',
          display: 'block',
          background: 'transparent',
        }} 
      />
      {selectedNode && selectedNode.id !== data.center.id && (
        <div
          className="absolute"
          style={{
            left: `${popupPosition.left}px`,
            top: `${popupPosition.top}px`,
            width: '24rem',
          }}
        >
          <div className="bg-white rounded-lg shadow-lg p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">{selectedNode.id}</h3>
            </div>
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
              </div>
            ) : aiAnalysis ? (
              <div className="prose prose-sm max-w-none">
                <div className="whitespace-pre-wrap text-gray-700">
                  {aiAnalysis}
                </div>
              </div>
            ) : (
              <div className="text-gray-500 text-center py-4">
                正在等待 AI 分析...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Graph;