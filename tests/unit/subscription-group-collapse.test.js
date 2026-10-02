import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import SubscriptionPanel from '../../src/components/subscriptions/SubscriptionPanel.vue';
import { clearDomainNameMemory } from '../../src/utils/domain-name-memory.js';

/**
 * 订阅源「按站点自动折叠」回归测试。
 *
 * 场景：同一家机场常有多个订阅链接（域名相同、路径 token 不同），
 * 逐个平铺会导致列表杂乱。面板按 URL 域名自动聚合，同一站点折叠为一组。
 *
 * 注意：分组标题会经 prettifyHost 美化（sub1.gsafevpn.com -> Gsafevpn），
 * 因此断言以「折叠结构 / 卡片数量」为准，不依赖具体显示文本。
 */

const makeSub = (id, name, url) => ({ id, name, url, enabled: true });

const mountPanel = (subscriptions) =>
    mount(SubscriptionPanel, {
        props: {
            subscriptions,
            paginatedSubscriptions: subscriptions,
            currentPage: 1,
            totalPages: 1,
        },
        global: {
            plugins: [createPinia()],
            stubs: {
                draggable: true,
                Card: { template: '<div class="stub-card" />' },
                MoreActionsMenu: { template: '<div><slot name="menu" /></div>' },
                PanelPagination: true,
                EmptyState: true,
            },
        },
    });

describe('订阅源按站点折叠', () => {
    beforeEach(() => {
        // 清掉命名记忆，避免残留影响分组标题
        clearDomainNameMemory();
    });

    it('同一域名的多个订阅源聚合为一个分组', async () => {
        const subs = [
            makeSub('a', 's1', 'https://sub1.gsafevpn.com/x/token1'),
            makeSub('b', 's2', 'https://sub1.gsafevpn.com/x/token2'),
            makeSub('c', 's3', 'https://sub1.gsafevpn.com/x/token3'),
        ];
        const wrapper = mountPanel(subs);
        await wrapper.vm.$nextTick();

        // 三张卡片都在（折叠但已渲染），且出现数量徽标 3
        expect(wrapper.findAll('.stub-card')).toHaveLength(3);
        expect(wrapper.html()).toContain('>3<');
        // 有可折叠分组时会出现「折叠全部」
        expect(wrapper.html()).toMatch(/折叠全部|Collapse all/);
    });

    it('单条目站点不折叠，直接平铺', async () => {
        const subs = [
            makeSub('a', 'a', 'https://only-one.example.com/sub'),
            makeSub('b', 'b', 'https://another.example.com/sub'),
        ];
        const wrapper = mountPanel(subs);
        await wrapper.vm.$nextTick();

        // 没有多条目分组时，不应出现折叠控件（展开全部按钮）
        expect(wrapper.html()).not.toMatch(/展开全部|Expand all/);
        // 卡片照样两张平铺
        expect(wrapper.findAll('.stub-card')).toHaveLength(2);
    });

    it('不同域名各自成组，不互相聚合', async () => {
        const subs = [
            makeSub('a', 'a', 'https://site-a.com/1'),
            makeSub('b', 'b', 'https://site-a.com/2'),
            makeSub('c', 'c', 'https://site-b.com/1'),
            makeSub('d', 'd', 'https://site-b.com/2'),
        ];
        const wrapper = mountPanel(subs);
        await wrapper.vm.$nextTick();

        // 两个分组，四张卡片全渲染；两组都带数量徽标 2
        expect(wrapper.findAll('.stub-card')).toHaveLength(4);
        const badgeCount = (wrapper.html().match(/>2</g) || []).length;
        expect(badgeCount).toBeGreaterThanOrEqual(2);
    });

    it('www. 前缀与裸域名归为同一组', async () => {
        const subs = [
            makeSub('a', 'a', 'https://www.example.com/1'),
            makeSub('b', 'b', 'https://example.com/2'),
        ];
        const wrapper = mountPanel(subs);
        await wrapper.vm.$nextTick();

        // 视为同站点 -> 折叠为一组（出现折叠控件），且标题不含 www.
        expect(wrapper.html()).toMatch(/折叠全部|Collapse all/);
        expect(wrapper.html()).not.toContain('www.example.com');
        expect(wrapper.findAll('.stub-card')).toHaveLength(2);
    });
});
