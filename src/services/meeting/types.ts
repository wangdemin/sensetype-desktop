
// 会议记录列表查询请求参数
export interface MeetingRecordsRequest {
  /**
   * 页码
   */
  page: number;
  /**
   * 搜索关键词(会议标题模糊匹配)
   */
  search?: string;
  /**
   * 每页条数
   */
  size: number;
}

// 会议记录列表查询响应
export interface MeetingRecordsResponse {
  list: MeetingRecord[];
  total: number;
}

// 会议记录条目
export interface MeetingRecord {
  /**
   * 音频文件URL
   */
  audio_file_url: string;
  /**
   * 创建时间（毫秒时间戳）
   */
  created_at: number;
  /**
   * 会议时长(秒)
   */
  duration: number;
  /**
   * 会议记录ID
   */
  id: string;
  /**
   * 状态: 0-进行中 1-已完成 2-失败
   */
  status: number;
  /**
   * 会议标题
   */
  title: string;
}

// 重命名会议记录请求参数
export interface RenameMeetingRequest {
  /**
   * 会议记录ID
   */
  id: string;
  /**
   * 新标题
   */
  title: string;
}

// 会议记录详情查询响应
export interface MeetingWord {
  /**
   * 单词/字
   */
  word: string;
  /**
   * 开始时间（毫秒）
   */
  start_time: number;
  /**
   * 结束时间（毫秒）
   */
  end_time: number;
}

export interface MeetingRawSentence {
  /**
   * 句子文本
   */
  text: string;
  /**
   * 词级时间戳
   */
  words: MeetingWord[];
}

export interface MeetingSummarySection {
  /**
   * 小节标题
   */
  heading?: string;
  /**
   * 小节要点
   */
  items?: string[];
  [property: string]: unknown;
}

export interface MeetingTranslatedSummarySection {
  /**
   * 翻译后的小节标题
   */
  heading?: string;
  /**
   * 翻译后的小节要点
   */
  items?: string[];
  [property: string]: unknown;
}

export interface MeetingSummary {
  /**
   * 总结标题
   */
  title?: string;
  /**
   * Markdown 总结内容
   */
  content?: string;
  /**
   * 结构化总结分段
   */
  sections?: MeetingSummarySection[];
  /**
   * 翻译后的总结标题
   */
  translated_title?: string;
  /**
   * 翻译后的 Markdown 总结内容
   */
  translated_content?: string;
  /**
   * 翻译后的结构化总结分段
   */
  translated_sections?: MeetingTranslatedSummarySection[];
  /**
   * 原始句子及词级时间戳
   */
  raw_sentences?: MeetingRawSentence[];
  /**
   * 总结索引
   */
  summary_index?: number;
  /**
   * 是否最终总结
   */
  is_final?: boolean;
  [property: string]: unknown;
}

export interface MeetingSegment {
  /**
   * 片段 ID（新接口可能不返回）
   */
  id?: string;
  /**
   * 片段序号（兼容字段）
   */
  segment_id?: number;
  /**
   * 片段文本
   */
  text?: string;
  /**
   * 片段翻译
   */
  translation?: string;
  /**
   * 开始时间（秒/毫秒，取决于接口）
   */
  start_at?: number;
  /**
   * 结束时间（秒/毫秒，取决于接口）
   */
  end_at?: number;
  /**
   * 开始时间（兼容字段，常见为毫秒）
   */
  timestamp_start?: number;
  /**
   * 结束时间（兼容字段，常见为毫秒）
   */
  timestamp_end?: number;
  /**
   * 是否最终片段
   */
  is_final?: boolean;
  /**
   * 词级时间戳
   */
  words?: MeetingWord[];
  /**
   * 创建时间（毫秒）
   */
  created_at?: number;
  [property: string]: unknown;
}

export interface MeetingOrganizedResult {
  /**
   * 是否最终组织结果
   */
  is_final?: boolean;
  /**
   * 组织结果索引
   */
  organize_index?: number;
  /**
   * 已组织的句子数量
   */
  organized_segment_count?: number;
  /**
   * 组织后的句子
   */
  sentences?: MeetingRawSentence[];
  [property: string]: unknown;
}

export interface MeetingDetailResponse {
  /**
   * 音频文件URL
   */
  audio_file_url?: string;
  /**
   * 创建时间
   */
  created_at?: number;
  /**
   * 会议时长（秒）
   */
  duration?: number;
  /**
   * 错误信息
   */
  error_message?: string;
  /**
   * 完成时间
   */
  finished_at?: number;
  /**
   * 会议记录ID
   */
  id?: string;
  /**
   * 识别分段结果
   */
  segments?: MeetingSegment[];
  /**
   * 总结内容
   */
  summary?: MeetingSummary;
  /**
   * 会议标题
   */
  title?: string;
  /**
   * 兼容旧字段：识别结果(原始数据)
   */
  result_final?: MeetingSegment[];
  /**
   * 兼容旧字段：识别结果(结构化数据)
   */
  result_organized?: MeetingOrganizedResult;
  [property: string]: unknown;
}