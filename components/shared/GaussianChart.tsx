
import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, ReferenceLine } from 'recharts';
import { generateGaussianData } from '../../utils';

interface GaussianChartProps {
  mean: number;
  sd: number;
  userScore: number;
  label: string;
  isActive?: boolean;
}

export const GaussianChart: React.FC<GaussianChartProps> = ({ mean, sd, userScore, isActive = true }) => {
  const data = useMemo(() => generateGaussianData(mean, sd), [mean, sd]);

  const xMin = mean - (3.5 * sd);
  const xMax = mean + (3.5 * sd);
  const totalRange = xMax - xMin;

  // Calculs pour les stops du dégradé
  const posMinus2SD = ((mean - (2 * sd)) - xMin) / totalRange * 100;
  const posMinus1SD = ((mean - (1 * sd)) - xMin) / totalRange * 100;
  
  const gradientId = useMemo(() => `grad-${Math.random().toString(36).substr(2, 9)}`, []);

  return (
    <div className="relative w-full h-full select-none">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#E07A5F" stopOpacity={0.7} /> {/* Terracotta (Difficulté) */}
              <stop offset={`${posMinus2SD}%`} stopColor="#E07A5F" stopOpacity={0.7} />
              <stop offset={`${posMinus2SD}%`} stopColor="#F2CC8F" stopOpacity={0.7} /> {/* Ocre (Fragilité) */}
              <stop offset={`${posMinus1SD}%`} stopColor="#F2CC8F" stopOpacity={0.7} />
              <stop offset={`${posMinus1SD}%`} stopColor="#81B29A" stopOpacity={0.7} /> {/* Sauge (Confort) */}
              <stop offset="100%" stopColor="#81B29A" stopOpacity={0.7} />
            </linearGradient>
            
            <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#3D405B" floodOpacity="0.2"/>
            </filter>
          </defs>
          
          <XAxis dataKey="x" type="number" domain={[xMin, xMax]} hide />
          <YAxis hide domain={[0, 'auto']} />
          
          <ReferenceLine x={mean} stroke="#E5E7EB" strokeDasharray="3 3" />

          <Area 
            type="monotone" 
            dataKey="y" 
            stroke="none" 
            fill={`url(#${gradientId})`}
            fillOpacity={0.6}
            animationDuration={800}
            isAnimationActive={isActive}
          />
          
          {isActive && (
            <ReferenceLine 
                x={userScore} 
                stroke="transparent"
                label={({ viewBox }) => {
                    const x = viewBox.x || 0;
                    const y = viewBox.height - 4; 
                    return (
                        <g transform={`translate(${x}, 0)`}>
                            <circle 
                                cx="0" 
                                cy={y} 
                                r="6" 
                                fill="#FFFFFF" 
                                stroke="#3D405B" 
                                strokeWidth="2" 
                                style={{ filter: 'url(#shadow)' }}
                            />
                        </g>
                    );
                }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
