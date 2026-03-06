import styles from '../common.module.scss';
import pageStyles from './index.module.scss';
import { useHoldToRecordKeyLabel } from '@/renderer/hooks/useHoldToRecordKeyLabel';
import PageHeader from '@/renderer/components/PageHeader';

type GuideListItem = { kind?: 'paragraph'; label?: string; text: string };
type GuidePanelItem =
  | { kind: 'paragraph'; text: string }
  | { kind: 'step'; title: string; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'example'; label: string; text: string };

type GuideBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'panel'; title: string; items: GuidePanelItem[] }
  | { type: 'list'; items: GuideListItem[] }
  | { type: 'faq'; items: Array<{ q: string; a: string }> };

type GuideSectionData = {
  title: string;
  blocks: GuideBlock[];
};

type ProductIntroProps = {
  title?: string;
  description: string;
  className?: string;
};

const ProductIntro = ({ title = '产品简介', description, className }: ProductIntroProps) => {
  return (
    <div className={`${pageStyles.productWrapper} ${className ?? ''}`}>
      <h2 className={pageStyles.productTitle}>{title}</h2>
      <p className={pageStyles.productDescription}>{description}</p>
    </div>
  );
};

const GuideSection = ({ section }: { section: GuideSectionData }) => {
  const renderPanelItem = (item: GuidePanelItem, idx: number) => {
    if (item.kind === 'paragraph') {
      return (
        <p
          key={idx}
          className={pageStyles.paragraph}
          dangerouslySetInnerHTML={{ __html: item.text }}
        />
      );
    }
    if (item.kind === 'step') {
      // 如果文本包含 <p> 标签，使用 div 而不是 span（因为 p 是块级元素）
      const hasParagraphTags = item.text.includes('<p>');
      const TextTag = hasParagraphTags ? 'div' : 'span';
      return (
        <div key={idx} className={pageStyles.step}>
          <span className={pageStyles.stepTitle}>{item.title}</span>
          <TextTag
            className={pageStyles.stepText}
            dangerouslySetInnerHTML={{ __html: item.text }}
          />
        </div>
      );
    }
    if (item.kind === 'example') {
      return (
        <div key={idx} className={pageStyles.example}>
          <span className={pageStyles.exampleLabel}>{item.label}</span>
          <span
            className={pageStyles.exampleText}
            dangerouslySetInnerHTML={{ __html: item.text }}
          />
        </div>
      );
    }
    return (
      <div
        key={idx}
        className={pageStyles.bullet}
        dangerouslySetInnerHTML={{ __html: item.text }}
      />
    );
  };

  return (
    <div className={pageStyles.sectionWrapper}>
      <div className={pageStyles.sectionHeader}>{section.title}</div>
      <div className={pageStyles.sectionBody}>
        {section.blocks.map((block, blockIdx) => {
          if (block.type === 'paragraph') {
            return (
              <p
                key={blockIdx}
                className={pageStyles.paragraph}
                dangerouslySetInnerHTML={{ __html: block.text }}
              />
            );
          }

          if (block.type === 'panel') {
            return (
              <div key={blockIdx} className={pageStyles.panel}>
                <div className={pageStyles.panelTitle}>{block.title}</div>
                <div className={pageStyles.panelBody}>
                  {block.items.map((item, idx) => renderPanelItem(item, idx))}
                </div>
              </div>
            );
          }

          if (block.type === 'list') {
            return (
              <div key={blockIdx} className={pageStyles.list}>
                {block.items.map((it, idx) => (
                  <div key={idx} className={pageStyles.listItem}>
                    {it.label ? <span className={pageStyles.listLabel}>{it.label}</span> : null}
                    <span
                      className={
                        it.kind === 'paragraph' ? pageStyles.paragraph : pageStyles.listText
                      }
                      dangerouslySetInnerHTML={{ __html: it.text }}
                    />
                  </div>
                ))}
              </div>
            );
          }

          return (
            <div key={blockIdx} className={pageStyles.faq}>
              {block.items.map((it, idx) => (
                <div key={idx} className={pageStyles.faqItem}>
                  <div className={pageStyles.faqQ}>
                    <span className={pageStyles.faqLabel}>Q：</span>
                    <span
                      className={pageStyles.faqText}
                      dangerouslySetInnerHTML={{ __html: it.q }}
                    />
                  </div>
                  <div className={pageStyles.faqA}>
                    <span className={pageStyles.faqBullet}>•</span>
                    <span className={pageStyles.faqLabel}>A：</span>
                    <span
                      className={pageStyles.faqText}
                      dangerouslySetInnerHTML={{ __html: it.a }}
                    />
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const UsagePage = () => {
  const { label, isMac, isWin } = useHoldToRecordKeyLabel();
  const keyLabel = isWin && !isMac ? `${label}键` : label;
  // 版本数据
  const versionData: {
    product: { title: string; description: string };
    sections: GuideSectionData[];
  } = {
    product: {
      title: '产品简介',
      description:
        'SenseAudio AI语音输入法是一款系统级的智能语音输入法，不仅能将您的语音实时转化为文字，还能通过简单的语音交互进行内容改写。无论是在社交软件、文档编辑器还是网页输入框，SenseAudio AI语音输入法都能为您提供丝滑的书写体验。',
    },
    sections: [
      {
        title: '智能语音输入',
        blocks: [
          {
            type: 'paragraph',
            text: '采用“即按即说”的交互逻辑，在任何您想要输入内容的地方按住快捷键直接说话，您的语音将迅速转成文字。',
          },
          {
            type: 'panel',
            title: '操作方法',
            items: [
              {
                kind: 'step',
                title: '第一步：定位光标',
                text: '该语音输入法支持在各种应用内使用，在您想要输入文字的界面中（如：对话框、文本框、编辑器等），点击鼠标左键，确保光标处于闪烁状态。',
              },
              {
                kind: 'step',
                title: '第二步：按下说话',
                text: '方式一：按住键盘上的快捷键（Windows系统默认快捷键为 <i>右Alt键</i> ，Mac系统默认为 <i>Option键</i> ）看到界面提示后开始说话。<br />方式二：同时按下键盘上的快捷键（Windows系统默认快捷键为 <i>Ctrl + Win键</i> ，Mac系统默认为 <i>Fn + 空格键</i> ）松开后即可开始说话，再次同时按下组合键即可停止。',
              },
              {
                kind: 'step',
                title: '第三步：识别输入',
                text: '说话结束后，AI会迅速给出反馈，并将完整的书面文字自动填充进光标位置。',
              },
            ],
          },
          {
            type: 'panel',
            title: '使用小贴士：',
            items: [
              {
                kind: 'bullet',
                text: '如在无法输入文字的地方或非输入状态下使用，识别出来的文字可以在历史记录中查看。',
              },
              {
                kind: 'bullet',
                text: '您不需要刻意组织语言，我们会自动识别并剔除语音中的无效语气词（如：呃、啊、那个等），如果出现了重复或者改口的情况，我们也将帮助您修正表达，直达最终结论。',
              },
            ],
          },
        ],
      },
      {
        title: '内容优化',
        blocks: [
          { type: 'paragraph', text: '通过语音交互即可对已有文字进行翻译、润色、扩写等。' },
          {
            type: 'panel',
            title: '操作方法',
            items: [
              { kind: 'step', title: '第一步：选中文字', text: '选中页面或文档中的一段目标文字。' },
              {
                kind: 'step',
                title: '第二步：下达指令',
                text: '按下键盘上的快捷键，唤醒输入法，直接说话下达指令。目前支持以下几种功能：',
              },
              {
                kind: 'example',
                label: '翻译：',
                text: '您可以说“把它翻译成英文”，“把这段话翻译成德语”。',
              },
              {
                kind: 'example',
                label: '改写：',
                text: '您可以说“把这段文字进行扩写”，“帮我优化一下这段文字”，“帮我把这句话改写成委婉的语气”。',
              },
              {
                kind: 'step',
                title: '第三步：结果',
                text: `
                  <p>识别完成后将出现文本框，此时显示的结果将自动复制到剪贴板，您可以自由粘贴在需要的位置。</p>
                  <p>如您需要对生成出来的内容进行修改，可以直接点击文字进行编辑，点击右下角的“复制并关闭”即可关闭当前文本框。</p>
                  <p>如您误关了文本框，可以打开历史记录查看过往记录。</p>
                `,
              },
            ],
          },
        ],
      },
      {
        title: '计费说明',
        blocks: [
          {
            type: 'panel',
            title: '',
            items: [
              {
                kind: 'step',
                title: '语音识别（语音转文字）',
                text: '  <p>说明：按照您实际输入的语音时长进行计算，不足1秒按1秒计算。</p> <p style="font-weight: 600; color: #141414;">计费标准： 5 积分 / 秒</p>',
              },
            ],
          },
          {
            type: 'panel',
            title: '',
            items: [
              {
                kind: 'step',
                title: '文本改写及翻译',
                text: '<p>说明：按照输出的字符数进行计算。</p><p style="font-weight: 600; color: #141414;">原价： 5 积分 / 字符</p><p style="font-weight: 600; color: #141414;">限时特惠： 1 积分 / 字符</p>',
              },
            ],
          },
          {
            type: 'panel',
            title: '',
            items: [
              {
                kind: 'step',
                title: '会议纪要（录音转文字 + 智能总结）',
                text: '<p>说明：按照会议持续的时长进行计算，不足1秒按1秒计算。</p><p style="font-weight: 600; color: #141414;">语音转写： 5 积分 / 秒（暂停期间不计费）</p><p style="font-weight: 600; color: #141414;">智能总结： 限时免费</p>',
              },
            ],
          },
          {
            type: 'list',
            items: [
              {
                label: '计费提示',
                text: '',
              },
              {
                label: '关于时长：',
                text: '所有语音相关功能均以“秒”为最小单位，不足1秒按照1秒进行计算。',
              },
              {
                label: '优惠说明：',
                text: '优惠说明：限时免费与特惠活动期间，系统将自动按最优价格为您结算。',
              },
            ],
          },
        ],
      },
      {
        title: '数据看板',
        blocks: [
          {
            type: 'list',
            items: [
              { kind: 'paragraph', text: '在首页的数据看板中，您可以实时查看自己的生产力轨迹：' },
              { label: '总口述时间：', text: '记录您使用语音输入的累计时长。' },
              { label: '总字数：', text: '统计通过SenseAudio AI语音输入法产出的文字总量。' },
              { label: '节省时间：', text: '展示为您省下的手动编辑与打字时间。' },
              {
                label: '平均口述速度：',
                text: '记录您的表达速度（每分钟字数），帮助您了解自己的沟通习惯。',
              },
            ],
          },
        ],
      },
      {
        title: '历史记录',
        blocks: [
          {
            type: 'list',
            items: [
              {
                label: '本地存储：',
                text: '您可以在此查看所有通过语音转换生成的文字记录，记录会自动按日期从近到远依次排列。所有的语音转文字记录仅存储在您的本地设备上，无法从其他地方访问。',
              },
              { label: '一键复制：', text: '选中历史记录后可以点击图标一键复制。' },
              { label: '快速清理：', text: '您可以通过“全部清除”按钮一键删除该账号中的历史记录。' },
            ],
          },
        ],
      },
      {
        title: '设置',
        blocks: [
          {
            type: 'list',
            items: [
              {
                label: '麦克风：',
                text: '您可以在此处选择您的麦克风，如您未手动选择，则为您匹配系统默认的麦克风。',
              },
              {
                label: '自动翻译：',
                text: '您可以选择语音识别后输出文字的语种类型。选择默认语言时，输出的文字语种将与语音输入的语种保持一致；选择特定语种时，无论语音输入的语种如何，都将按照您选定的语种进行输出，如您选择输出英语，那么无论您说中文还是法语，都将直接输出英语。',
              },
              {
                label: '登录时启用：',
                text: '开启该功能后，当计算机启动时，将自动打开SenseAudio AI语音输入法，您可以即刻开始使用；关闭后，如您需要使用，则需要手动打开客户端。',
              },
            ],
          },
        ],
      },
      {
        title: '账户',
        blocks: [
          {
            type: 'list',
            items: [{ label: '退出登录：', text: '点击“退出登录”即可退出当前账号。' }],
          },
        ],
      },
      {
        title: '套餐',
        blocks: [
          {
            type: 'list',
            items: [
              {
                label: '积分查看：',
                text: '您可以在左下角查看当前积分剩余情况，点击“箭头图标”可以查看积分使用情况。',
              },
              {
                label: '套餐升级：',
                text: '点击“升级套餐”后将自动跳转购买页面，您可以选择合适的套餐进行购买，支持使用支付宝进行付款。',
              },
            ],
          },
        ],
      },
      {
        title: '常见问题（FAQ）',
        blocks: [
          {
            type: 'faq',
            items: [
              {
                q: '为什么按住快捷键没反应？',
                a: '请确认SenseAudio AI语音输入法是否已获得麦克风权限，或检查是否有其他翻译/输入类软件占用了该快捷键。',
              },
              {
                q: '内容优化功能没有反应？',
                a: `请确保先选中文字再按住 ${keyLabel}。如果未选中文字，系统会默认进入“智能语音输入”模式。`,
              },
              {
                q: '支持哪些软件？',
                a: `支持所有 ${isWin ? 'Windows' : 'Mac'} 标准输入环境，包括但不限于各类浏览器、聊天软件及文档编辑器。`,
              },
            ],
          },
        ],
      },
    ],
  };

  return (
    <div className={`${styles.page} ${pageStyles.version}`}>
      <PageHeader title="输入法用户操作指南" subtitle="帮助您快速熟悉各项核心功能" />
      <ProductIntro
        title={versionData.product.title}
        description={versionData.product.description}
      />
      <div className={pageStyles.versionContent}>
        <div className={pageStyles.sections}>
          {versionData.sections.map((section, index) => (
            <GuideSection key={index} section={section} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default UsagePage;
