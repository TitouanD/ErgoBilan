import React from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface ChartPoint {
  date: string;
  score: number;
}

interface Props {
  data: ChartPoint[];
}

export const PatientEvolutionChart: React.FC<Props> = ({ data }) => {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f5" />
        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#A8A29E' }} />
        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#A8A29E' }} domain={[0, 20]} />
        <Tooltip />
        <Area type="monotone" dataKey="score" stroke="#E07A5F" strokeWidth={3} fill="#E07A5F22" />
      </AreaChart>
    </ResponsiveContainer>
  );
};
