import { useDataStore } from '../stores/useDataStore.js';
import { useToastStore } from '../stores/toast.js';
import { normalizeSourceCollection } from '../shared/source-utils.js';
import { api } from '../lib/http.js';
import { decryptBackupPayload, encryptBackupPayload } from '../shared/backup-crypto.js';
import { verifyLogicalBackup } from '../shared/backup-format.js';

const MAX_BACKUP_BYTES = 32 * 1024 * 1024;

function downloadJSON(data, fileName) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

function timestamp() {
    return new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
}

/**
 * 备份和恢复逻辑 composable
 * 提供统一的数据备份和恢复功能
 * 用于设置模块、Dashboard 等所有需要备份功能的地方
 */
export function useBackupLogic() {
    const dataStore = useDataStore();
    const { showToast } = useToastStore();

    /**
     * 导出备份
     * 从服务端读取完整逻辑数据并导出加密 JSON 文件
     */
    const exportBackup = async () => {
        try {
            const passphrase = window.prompt('请输入备份加密口令（恢复时需要）');
            if (!passphrase) return;
            if (window.prompt('请再次输入备份加密口令') !== passphrase) {
                throw new Error('两次输入的加密口令不一致');
            }
            const response = await api.post('/api/system/export', {});
            if (!response?.success) throw new Error(response?.error || '服务端导出失败');
            const envelope = await encryptBackupPayload(response.exportData, passphrase);
            downloadJSON(envelope, `misub-backup-${timestamp()}.encrypted.json`);
            showToast('加密备份已成功导出', 'success');
        } catch (error) {
            console.error('Backup export failed:', error);
            showToast('备份导出失败', 'error');
        }
    };

    /**
     * 导入备份
     * 从加密 JSON 恢复完整逻辑数据
     */
    const importBackup = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            if (file.size > MAX_BACKUP_BYTES) {
                showToast('备份文件超过 32 MiB 限制', 'error');
                return;
            }

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const envelope = JSON.parse(e.target.result);
                    const passphrase = window.prompt('请输入此备份的加密口令');
                    if (!passphrase) return;
                    const backup = await decryptBackupPayload(envelope, passphrase);
                    await verifyLogicalBackup(backup);

                    if (confirm('确定要从加密备份中恢复吗？当前数据将被覆盖，恢复前会自动下载一份快照。')) {
                        const current = await api.post('/api/system/export', {});
                        if (!current?.success) throw new Error('无法创建恢复前快照');
                        const preRestore = await encryptBackupPayload(current.exportData, passphrase);
                        downloadJSON(preRestore, `misub-pre-restore-${timestamp()}.encrypted.json`);

                        dataStore.overwriteSubscriptions(normalizeSourceCollection(backup.data.sources));
                        dataStore.overwriteProfiles(backup.data.profiles);
                        await dataStore.saveSettings(backup.data.settings || {});
                        dataStore.markDirty();
                        showToast('数据已恢复，请检查后保存来源和 Profile', 'success');
                    }
                } catch (err) {
                    showToast('导入失败: ' + err.message, 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    return {
        exportBackup,
        importBackup,
    };
}
