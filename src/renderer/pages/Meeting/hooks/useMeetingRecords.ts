import { useState, useCallback } from 'react';
import {
  getMeetingRecords,
  renameMeeting,
  deleteMeeting,
  batchDeleteMeetings,
} from '@/services/meeting';
import { message } from '@/renderer/components/Message';
import { convertToMeetingItem, getErrorMessage } from '../utils';
import { PAGE_SIZE } from '../constants';
import type { MeetingItem } from '../list';

export function useMeetingRecords() {
  const [meetings, setMeetings] = useState<MeetingItem[]>([]);
  const [page, setPage] = useState(1);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const loadMeetings = useCallback(
    async (pageNum: number, search: string, append: boolean = false) => {
      if (isLoading) return;

      setIsLoading(true);
      try {
        const response = await getMeetingRecords({
          page: pageNum,
          size: PAGE_SIZE,
          search: search || undefined,
        });
        console.log('getMeetingRecords', response);
        if (response.success && response.data) {
          const newMeetings = response.data.list.map(convertToMeetingItem);
          setMeetings((prev) => (append ? [...prev, ...newMeetings] : newMeetings));
          setTotal(response.data.total);
          setHasMore(newMeetings.length === PAGE_SIZE);
        }
      } catch (error) {
        console.error('加载会议列表失败:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading],
  );

  const handleSearchChange = useCallback(
    (search: string) => {
      setSearchKeyword(search);
      setPage(1);
      setMeetings([]);
      loadMeetings(1, search);
    },
    [loadMeetings],
  );

  const handleLoadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      loadMeetings(nextPage, searchKeyword, true);
    }
  }, [isLoading, hasMore, page, searchKeyword, loadMeetings]);

  const handleRename = useCallback(async (id: string, newTitle: string): Promise<boolean> => {
    try {
      await renameMeeting({ id, title: newTitle });
      setMeetings((prev) => prev.map((m) => (m.id === id ? { ...m, title: newTitle } : m)));
      message.success('重命名成功');
      return true;
    } catch (error) {
      console.error('重命名失败:', error);
      message.error(getErrorMessage(error, '重命名失败，请稍后重试'));
      return false;
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteMeeting(id);
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      setTotal((prev) => prev - 1);
      message.success('删除成功');
    } catch (error) {
      console.error('删除失败:', error);
      message.error(getErrorMessage(error, '删除失败，请稍后重试'));
    }
  }, []);

  const handleBatchDelete = useCallback(async (selectedIds: Set<string>) => {
    try {
      const idsToDelete = Array.from(selectedIds);
      await batchDeleteMeetings(idsToDelete);
      setMeetings((prev) => prev.filter((m) => !selectedIds.has(m.id)));
      setTotal((prev) => prev - idsToDelete.length);
      message.success(`成功删除 ${idsToDelete.length} 条会议纪要`);
      return true;
    } catch (error) {
      console.error('批量删除失败:', error);
      message.error(getErrorMessage(error, '批量删除失败，请稍后重试'));
      return false;
    }
  }, []);

  const refreshList = useCallback(() => {
    loadMeetings(1, '');
  }, [loadMeetings]);

  return {
    meetings,
    total,
    isLoading,
    hasMore,
    loadMeetings,
    handleSearchChange,
    handleLoadMore,
    handleRename,
    handleDelete,
    handleBatchDelete,
    refreshList,
  };
}
