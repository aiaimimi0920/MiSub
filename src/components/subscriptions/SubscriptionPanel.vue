<script setup>
    import { computed, ref, nextTick } from 'vue';
    import draggable from 'vuedraggable';
    import Card from '../ui/Card.vue';
    import MoreActionsMenu from '@/components/shared/MoreActionsMenu.vue';
    import PanelPagination from '@/components/shared/PanelPagination.vue';
    import EmptyState from '@/components/ui/EmptyState.vue';
    import { useUIStore } from '@/stores/ui';
    import { useI18n } from '@/i18n/index.js';
    import { inferAirportRootDomain } from '../../utils/airport-domain.js';
    import { lookupDomainName } from '../../utils/domain-name-memory.js';

    const { layoutMode } = useUIStore();
    const { t } = useI18n();

    const props = defineProps({
        subscriptions: { type: Array, default: () => [] },
        paginatedSubscriptions: Array,
        currentPage: Number,
        totalPages: Number,
        isSorting: Boolean,
        searchable: { type: Boolean, default: false },
        searchQuery: { type: String, default: '' },
        filteredCount: { type: Number, default: undefined },
        // Active status filter coming from a dashboard deep link (?status=...).
        statusFilter: { type: String, default: '' },
        statusFilterLabel: { type: String, default: '' },
    });

    const emit = defineEmits([
        'add',
        'delete',
        'changePage',
        'updateNodeCount',
        'edit',
        'toggleSort',
        'markDirty',
        'preview',
        'deleteAll',
        'refreshAll',
        'reorder',
        'import',
        'qrcode',
        'updateSearch',
        'applyDetectedName',
        'rename-group',
        'clearStatusFilter',
    ]);

    const searchModel = computed({
        get: () => props.searchQuery,
        set: (value) => emit('updateSearch', value),
    });

    const visibleCount = computed(() => props.filteredCount ?? props.subscriptions.length);

    const draggableSubscriptions = computed({
        get: () => [...props.subscriptions],
        set: (val) => emit('reorder', val),
    });

    const handleDelete = (id) => emit('delete', id);
    const handleEdit = (id) => emit('edit', id);
    const handleUpdate = (id) => emit('updateNodeCount', id);
    const handlePreview = (id) => emit('preview', id);
    const handleQRCode = (id) => emit('qrcode', id);
    const handleAdd = () => emit('add');
    const handleChangePage = (page) => emit('changePage', page);
    const handleToggleSort = () => emit('toggleSort');
    const handleSortEnd = () => emit('markDirty');
    const handleDeleteAll = () => emit('deleteAll');
    const handleRefreshAll = () => emit('refreshAll');
    const handleImport = () => emit('import');

    // 应用识别到的机场名：模板内联箭头函数无法访问 emit，需用具名函数转发
    // 一键重命名整组：转发给父组件并刷新折叠标题
    const handleRenameGroup = (group) => {
        emit(
            'rename-group',
            group.items.map((it) => it.id),
            groupDetectedName(group)
        );
        setTimeout(refreshNameMemory, 0);
    };

    const handleApplyDetectedName = (subscription, name) => {
        emit('applyDetectedName', subscription?.id, name);
        // 父组件同步写入命名记忆，放到下一个 tick 刷新折叠标题
        setTimeout(refreshNameMemory, 0);
    };

    /**
     * 取该折叠组可用于重命名的名字（基础名）。
     * 优先级：
     *   1. 组内任一订阅的识别名（detectedName，来自 Profile-Title / 官网标题）
     *   2. 组域名推断出的品牌名（如 gsafevpn.com -> Gsafevpn）
     *   3. 组域名原文
     * 始终返回非空（除非组本身无 host），保证按钮可用。
     */
    const prettifyHost = (host) => {
        const raw = String(host || '').trim();
        if (!raw) return '';
        // 先去掉 sub1/api/dy11 之类的子域前缀，拿到机场主域名
        const root = inferAirportRootDomain(`https://${raw}`) || raw;
        const parts = root.split('.');
        let main = parts[0];
        // 处理 com.cn / co.uk 这类多段后缀
        if (parts.length >= 3 && ['com', 'net', 'org', 'gov', 'edu', 'co'].includes(parts[1])) {
            main = parts[1];
        }
        // 去掉带分隔符的常见拼接后缀（如 xxx-vpn），再首字母大写
        // 注意：不剥离「紧贴」的 vpn（gsafevpn 应保留为 Gsafevpn）
        const cleaned = main
            .replace(/[-_](vpn|proxy|cloud|services?|network|sub|node)$/i, '')
            .replace(/[-_]+/g, ' ')
            .trim();
        const base = cleaned || main;
        return base.charAt(0).toUpperCase() + base.slice(1);
    };

    const groupDetectedName = (group) => {
        const hit = (group?.items || []).find(
            (item) => typeof item?.detectedName === 'string' && item.detectedName.trim()
        );
        if (hit) return hit.detectedName.trim();
        if (group?.host) return prettifyHost(group.host);
        return '';
    };

    /**
     * 折叠组的显示名（标题栏）：
     *   1. 该域名记住的机场名（用户确认过，最准）
     *   2. 组内任一订阅的识别名
     *   3. 组域名
     */
    // 命名记忆存于 localStorage（非响应式），用一个版本号触发重算，
    // 使「重命名整组 / 应用识别名」后折叠标题立即更新。
    const nameMemoryVersion = ref(0);

    const groupDisplayName = (group) => {
        // 依赖 version，改名后自动重算
        void nameMemoryVersion.value;
        const host = group?.host || '';
        if (host) {
            const remembered = lookupDomainName(host);
            if (remembered) return remembered;
        }
        const detected = groupDetectedName(group);
        if (detected) return detected;
        return host || t('subscriptions.otherSources');
    };

    /** 通知命名记忆已更新，触发折叠标题重算 */
    const refreshNameMemory = () => {
        nameMemoryVersion.value += 1;
    };

    // === 按站点自动折叠 ===
    // 同一家机场常有多个订阅链接（域名相同、路径 token 不同），逐个平铺会很乱。
    // 这里按 URL 的域名自动聚合，同一站点的订阅源折叠为一组，可展开查看。
    const collapsedGroups = ref(new Set());

    /** 从订阅 URL 提取站点标识（域名）；非 http 链接归入「其他」。 */
    const siteKeyOf = (sub) => {
        try {
            const host = new URL(sub.url).hostname;
            return host ? host.replace(/^www\./, '') : '';
        } catch (e) {
            return '';
        }
    };

    /**
     * 将被分页截断的列表还原为完整列表，再按站点聚合。
     * 注意：分组会绕过分页（组内项目一次性展示），因此这里使用完整列表。
     */
    const groupedSubscriptions = computed(() => {
        const list = props.subscriptions || [];
        const order = [];
        const map = new Map();

        list.forEach((sub) => {
            const key = siteKeyOf(sub) || '';
            if (!map.has(key)) {
                map.set(key, []);
                order.push(key);
            }
            map.get(key).push(sub);
        });

        return order.map((key) => ({
            key: key || '__other__',
            host: key,
            items: map.get(key),
        }));
    });

    /** 只有多条目站点才值得折叠；单条目站点直接平铺，避免多余的展开操作。 */
    const collapsibleGroups = computed(() =>
        groupedSubscriptions.value.filter((g) => g.items.length > 1)
    );

    /** 单条目站点（不折叠，直接平铺展示）。 */
    const ungroupedSubscriptions = computed(() =>
        groupedSubscriptions.value.filter((g) => g.items.length === 1).flatMap((g) => g.items)
    );

    const toggleGroup = (key) => {
        const next = new Set(collapsedGroups.value);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        collapsedGroups.value = next;
    };

    const isGroupCollapsed = (key) => collapsedGroups.value.has(key);

    const isGrouped = computed(() => collapsibleGroups.value.length > 0);

    const collapseAllGroups = () => {
        collapsedGroups.value = new Set(collapsibleGroups.value.map((g) => g.key));
    };

    const expandAllGroups = () => {
        collapsedGroups.value = new Set();
    };
</script>

<template>
    <div>
        <div
            class="mb-4 rounded-xl border border-gray-100/80 bg-white/85 p-4 shadow-sm dark:border-white/10 dark:bg-gray-900/70"
        >
            <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div class="min-w-0">
                    <div class="flex items-center gap-3 shrink-0">
                        <h2 class="text-xl font-bold text-gray-900 dark:text-white">
                            {{ t('subscriptions.title') }}
                        </h2>
                        <span
                            class="rounded-full bg-gray-100 px-2.5 py-0.5 text-sm font-semibold text-gray-700 dark:bg-white/10 dark:text-gray-200"
                            >{{ subscriptions.length }}</span
                        >
                    </div>
                    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {{ t('subscriptions.subtitle') }}
                    </p>
                </div>
                <div
                    class="flex flex-wrap items-center gap-2 sm:w-auto justify-end sm:justify-start"
                >
                    <slot name="actions-prepend"></slot>
                    <button
                        @click="handleImport"
                        class="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10"
                    >
                        {{ t('actions.bulkImport') }}
                    </button>
                    <button
                        v-if="isGrouped && !isSorting"
                        @click="collapseAllGroups"
                        class="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10"
                    >
                        {{ t('subscriptions.collapseAll') }}
                    </button>
                    <button
                        v-if="isGrouped && !isSorting"
                        @click="expandAllGroups"
                        class="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10"
                    >
                        {{ t('subscriptions.expandAll') }}
                    </button>
                    <button
                        @click="handleAdd"
                        class="shrink-0 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
                    >
                        {{ t('actions.add') }}
                    </button>
                    <MoreActionsMenu menu-width-class="w-36">
                        <template #menu="{ close }">
                            <button
                                @click="
                                    handleRefreshAll();
                                    close();
                                "
                                class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                                {{ t('actions.refreshAll') }}
                            </button>
                            <button
                                @click="
                                    handleToggleSort();
                                    close();
                                "
                                class="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                                {{ isSorting ? t('actions.finishSort') : t('actions.manualSort') }}
                            </button>
                            <div class="border-t border-gray-200 dark:border-gray-700 my-1"></div>
                            <button
                                @click="
                                    handleDeleteAll();
                                    close();
                                "
                                class="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-500/10"
                            >
                                {{ t('actions.clearAll') }}
                            </button>
                        </template>
                    </MoreActionsMenu>
                </div>
            </div>
            <div v-if="searchable" class="relative mt-4">
                <svg
                    class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-gray-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                    v-model="searchModel"
                    data-testid="subscription-search"
                    type="search"
                    :placeholder="t('subscriptions.listSearchPlaceholder')"
                    :aria-label="t('subscriptions.searchPlaceholder')"
                    :disabled="isSorting"
                    class="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-20 text-sm text-gray-900 outline-none transition focus:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-gray-500"
                />
                <span
                    v-if="searchQuery"
                    class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 dark:text-gray-400"
                >
                    {{ visibleCount }}/{{ subscriptions.length }}
                </span>
            </div>

            <div
                v-if="statusFilter"
                data-testid="subscription-status-filter"
                class="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200"
            >
                <span>{{ statusFilterLabel }}</span>
                <span class="opacity-70">{{ visibleCount }}/{{ subscriptions.length }}</span>
                <button
                    type="button"
                    data-testid="subscription-status-filter-clear"
                    class="ml-auto font-semibold underline underline-offset-2 hover:opacity-80"
                    @click="emit('clearStatusFilter')"
                >
                    {{ t('subscriptions.clearStatusFilter') }}
                </button>
            </div>
        </div>
        <div v-if="subscriptions.length > 0">
            <draggable
                v-if="isSorting"
                tag="div"
                class="grid grid-cols-1 md:grid-cols-2 gap-4"
                v-model="draggableSubscriptions"
                item-key="id"
                animation="300"
                @end="handleSortEnd"
            >
                <template #item="{ element: subscription }">
                    <div class="cursor-move">
                        <Card
                            :misub="subscription"
                            @delete="handleDelete(subscription.id)"
                            @change="handleSortEnd"
                            @update="handleUpdate(subscription.id)"
                            @edit="handleEdit(subscription.id)"
                            @preview="handlePreview(subscription.id)"
                            @qrcode="handleQRCode(subscription.id)"
                            @applyDetectedName="
                                (name) => handleApplyDetectedName(subscription, name)
                            "
                        />
                    </div>
                </template>
            </draggable>
            <div v-else-if="paginatedSubscriptions.length > 0" class="space-y-4">
                <!-- 按站点分组：同站点的多个订阅源折叠为一组 -->
                <template v-if="isGrouped">
                    <template v-for="group in collapsibleGroups" :key="group.key">
                        <div
                            class="rounded-xl border border-gray-100/80 bg-white/70 shadow-sm dark:border-white/10 dark:bg-gray-900/50"
                        >
                            <div class="flex w-full items-center justify-between gap-3 px-4 py-3">
                                <button
                                    type="button"
                                    class="flex min-w-0 flex-1 items-center gap-2 text-left"
                                    @click="toggleGroup(group.key)"
                                >
                                    <svg
                                        class="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400 transition-transform"
                                        :class="isGroupCollapsed(group.key) ? '-rotate-90' : ''"
                                        viewBox="0 0 20 20"
                                        fill="currentColor"
                                        aria-hidden="true"
                                    >
                                        <path
                                            fill-rule="evenodd"
                                            d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                                            clip-rule="evenodd"
                                        />
                                    </svg>
                                    <span
                                        class="truncate font-semibold text-gray-800 dark:text-gray-100"
                                    >
                                        {{ groupDisplayName(group) }}
                                    </span>
                                    <span
                                        class="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-white/10 dark:text-gray-300"
                                    >
                                        {{ group.items.length }}
                                    </span>
                                </button>
                                <div class="flex shrink-0 items-center gap-2">
                                    <!-- 一键重命名整组：使用识别到的机场名 + 序号，避免重名 -->
                                    <button
                                        v-if="groupDetectedName(group)"
                                        type="button"
                                        class="rounded-md border border-primary-500/30 px-2 py-1 text-[11px] font-medium text-primary-500 transition-colors hover:bg-primary-500/10 dark:text-primary-400"
                                        :title="
                                            t('subscriptions.renameGroupHint', {
                                                name: groupDetectedName(group),
                                            })
                                        "
                                        @click.stop="handleRenameGroup(group)"
                                    >
                                        {{ t('subscriptions.renameGroup') }}
                                    </button>
                                    <span class="text-xs text-gray-500 dark:text-gray-400">
                                        {{
                                            isGroupCollapsed(group.key)
                                                ? t('subscriptions.expand')
                                                : t('subscriptions.collapse')
                                        }}
                                    </span>
                                </div>
                            </div>
                            <div
                                v-show="!isGroupCollapsed(group.key)"
                                class="grid grid-cols-1 gap-4 border-t border-gray-100/80 p-4 md:grid-cols-2 dark:border-white/10"
                            >
                                <div
                                    v-for="(subscription, index) in group.items"
                                    :key="subscription.id"
                                    class="list-item-animation"
                                    :style="{ '--delay-index': index }"
                                >
                                    <Card
                                        :misub="subscription"
                                        @delete="handleDelete(subscription.id)"
                                        @change="handleSortEnd"
                                        @update="handleUpdate(subscription.id)"
                                        @edit="handleEdit(subscription.id)"
                                        @preview="handlePreview(subscription.id)"
                                        @qrcode="handleQRCode(subscription.id)"
                                        @applyDetectedName="
                                            (name) => handleApplyDetectedName(subscription, name)
                                        "
                                    />
                                </div>
                            </div>
                        </div>
                    </template>

                    <!-- 单条目站点平铺 -->
                    <div
                        v-if="ungroupedSubscriptions.length > 0"
                        class="grid grid-cols-1 gap-4 md:grid-cols-2"
                    >
                        <div
                            v-for="(subscription, index) in ungroupedSubscriptions"
                            :key="subscription.id"
                            class="list-item-animation"
                            :style="{ '--delay-index': index }"
                        >
                            <Card
                                :misub="subscription"
                                @delete="handleDelete(subscription.id)"
                                @change="handleSortEnd"
                                @update="handleUpdate(subscription.id)"
                                @edit="handleEdit(subscription.id)"
                                @preview="handlePreview(subscription.id)"
                                @qrcode="handleQRCode(subscription.id)"
                                @applyDetectedName="
                                    (name) => handleApplyDetectedName(subscription, name)
                                "
                            />
                        </div>
                    </div>
                </template>

                <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div
                        v-for="(subscription, index) in paginatedSubscriptions"
                        :key="subscription.id"
                        class="list-item-animation"
                        :style="{ '--delay-index': index }"
                    >
                        <Card
                            :misub="subscription"
                            @delete="handleDelete(subscription.id)"
                            @change="handleSortEnd"
                            @update="handleUpdate(subscription.id)"
                            @edit="handleEdit(subscription.id)"
                            @preview="handlePreview(subscription.id)"
                            @qrcode="handleQRCode(subscription.id)"
                            @applyDetectedName="
                                (name) => handleApplyDetectedName(subscription, name)
                            "
                        />
                    </div>
                </div>
            </div>
            <div
                v-else
                class="rounded-xl border border-dashed border-gray-300 bg-white/60 px-6 py-12 text-center dark:border-gray-700 dark:bg-gray-900/50"
            >
                <p class="text-sm font-medium text-gray-700 dark:text-gray-200">
                    {{ t('subscriptions.noSearchResults') }}
                </p>
                <button
                    type="button"
                    class="mt-3 text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
                    @click="searchModel = ''"
                >
                    {{ t('actions.clearSearch') }}
                </button>
            </div>
            <PanelPagination
                v-if="totalPages > 1 && !isSorting"
                variant="panel"
                :current-page="currentPage"
                :total-pages="totalPages"
                :total-items="visibleCount"
                :show-total-items="true"
                @change-page="handleChangePage"
            />
        </div>
        <div
            v-else
            class="rounded-xl border border-dashed border-gray-300 bg-white/60 py-6 dark:border-gray-700 dark:bg-gray-900/50"
        >
            <EmptyState
                :title="t('subscriptions.empty')"
                :description="t('subscriptions.emptyDesc')"
                icon="folder"
                :total-count="0"
            />
            <div class="-mt-8 mb-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <button
                    data-testid="empty-add-subscription"
                    @click="handleAdd"
                    class="inline-flex items-center justify-center rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30"
                >
                    {{ t('subscriptions.addEmpty') }}
                </button>
                <button
                    data-testid="empty-import-subscriptions"
                    @click="handleImport"
                    class="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
                >
                    {{ t('actions.bulkImport') }}
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .cursor-move {
        cursor: move;
    }
</style>
