import { ipcBridge } from '@/common';
import { Button, Spin } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import TeamPage from './TeamPage';

const TeamIndex: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: team, isLoading } = useSWR(id ? `team/${id}` : null, () => ipcBridge.team.get.invoke({ id: id! }));

  if (isLoading) return <Spin loading />;
  // [mycowork] A532：团队不存在时给出提示与返回首页，不留空白主区
  if (!team)
    return (
      <div className='flex flex-col items-center justify-center gap-12px h-full' role='alert'>
        <span>{t('team.pageNotFound')}</span>
        <Button onClick={() => void navigate('/guid')}>{t('team.backHome')}</Button>
      </div>
    );
  return <TeamPage key={team.id} team={team} />;
};

export default TeamIndex;
