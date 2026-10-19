'use strict';
(function () {
    var tablesEl = document.getElementById('tables');
    var statusEl = document.getElementById('status');
    var statusTextEl = document.getElementById('statusText');
    var formEl = document.getElementById('form');
    var errEl = document.getElementById('formError');
    var reqEl = document.getElementById('req');
    var resEl = document.getElementById('res');
    var groupEl = document.getElementById('group');
    var diagSubEl = document.getElementById('diagSub');
    var diagListEl = document.getElementById('diagList');
    var previewInput = document.getElementById('previewInput');
    var previewOut = document.getElementById('previewOut');
    var importFile = document.getElementById('importFile');

    var maps = [];
    var editingIndex = -1;
    var diagnostics = null;

    function setStatus(text, kind) {
        statusTextEl.textContent = text;
        statusEl.className = 'status' + (kind ? ' ' + kind : '');
    }

    function showForm(rule, index) {
        editingIndex = index;
        reqEl.value = rule.req || '';
        resEl.value = rule.res || '';
        groupEl.value = rule.group || '';
        errEl.hidden = true;
        formEl.hidden = false;
        reqEl.focus();
    }

    function hideForm() {
        formEl.hidden = true;
        editingIndex = -1;
        errEl.hidden = true;
    }

    function validate(rule) {
        if (!rule.req) {
            return 'If URL match 不能为空';
        }
        var engineError = ReResEngine.checkPattern(rule.req);
        if (engineError) {
            return engineError;
        }
        if (!rule.res) {
            return 'Response 不能为空';
        }
        var target = ReResEngine.classifyTarget(rule.res);
        if (target.kind === 'blocked') {
            return target.message;
        }
        return null;
    }

    function renderTables() {
        tablesEl.textContent = '';
        if (!maps.length) {
            var empty = ReRes.el('div', 'panel');
            empty.appendChild(ReRes.el('div', 'empty', '还没有规则，点击右上角「添加规则」或「导入」配置。'));
            tablesEl.appendChild(empty);
            return;
        }

        ReRes.groupBy(maps).forEach(function (group) {
            var wrap = ReRes.el('div', 'group');
            wrap.appendChild(ReRes.el('h4', null, group.group));

            var table = ReRes.el('table', 'rules');
            var thead = ReRes.el('thead');
            var headRow = ReRes.el('tr');
            ['启用', 'If URL match', 'Response', '操作'].forEach(function (title) {
                headRow.appendChild(ReRes.el('th', null, title));
            });
            thead.appendChild(headRow);
            table.appendChild(thead);

            var tbody = ReRes.el('tbody');
            group.items.forEach(function (item) {
                tbody.appendChild(renderRow(item));
            });
            table.appendChild(tbody);
            wrap.appendChild(table);
            tablesEl.appendChild(wrap);
        });
    }

    function renderRow(item) {
        var rule = item.rule;
        var tr = ReRes.el('tr');

        var tdCheck = ReRes.el('td', 'center');
        var check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'check';
        check.checked = rule.checked === true;
        check.addEventListener('change', function () {
            rule.checked = check.checked;
            persist();
        });
        tdCheck.appendChild(check);

        var tdReq = ReRes.el('td', 'mono', rule.req);
        tdReq.title = rule.req;
        var tdRes = ReRes.el('td', 'mono', rule.res);
        tdRes.title = rule.res;

        var tdOps = ReRes.el('td');
        var ops = ReRes.el('div', 'ops');

        var editBtn = ReRes.el('button', 'btn btn-light btn-xs', '编辑');
        editBtn.type = 'button';
        editBtn.addEventListener('click', function () {
            showForm(rule, item.index);
        });

        var delBtn = ReRes.el('button', 'btn btn-danger btn-xs', '删除');
        delBtn.type = 'button';
        delBtn.addEventListener('click', function () {
            maps.splice(item.index, 1);
            persist();
        });

        ops.appendChild(editBtn);
        ops.appendChild(delBtn);
        tdOps.appendChild(ops);

        tr.appendChild(tdCheck);
        tr.appendChild(tdReq);
        tr.appendChild(tdRes);
        tr.appendChild(tdOps);
        return tr;
    }

    function renderDiagnostics() {
        diagListEl.textContent = '';
        if (!diagnostics) {
            diagSubEl.textContent = '尚未同步。';
            return;
        }
        var applied = typeof diagnostics.applied === 'number' ? diagnostics.applied : 0;
        var errors = diagnostics.errors || [];
        var warns = diagnostics.warnings || [];
        diagSubEl.textContent = '已向浏览器注册 ' + applied + ' 条重定向规则' +
            (diagnostics.at ? '（' + new Date(diagnostics.at).toLocaleString() + '）' : '');

        function appendItems(list, className) {
            list.forEach(function (item) {
                var li = document.createElement('li');
                if (className) {
                    li.className = className;
                }
                var parts = [];
                if (item.req) {
                    parts.push('规则：' + item.req);
                }
                if (item.res) {
                    parts.push('→ ' + item.res);
                }
                li.textContent = (parts.length ? parts.join(' ') + ' · ' : '') + item.message;
                diagListEl.appendChild(li);
            });
        }

        appendItems(errors, null);
        appendItems(warns, 'warn');

        if (errors.length) {
            setStatus('已生效 ' + applied + ' 条，' + errors.length + ' 条规则存在问题', 'error');
        } else if (applied > 0) {
            setStatus('已生效 ' + applied + ' 条重定向规则' +
                (warns.length ? '，' + warns.length + ' 条有提示' : ''), 'ok');
        } else {
            setStatus('当前没有启用的规则');
        }
    }

    function persist() {
        return ReRes.setMaps(maps)
            .then(ReRes.sync)
            .then(function (result) {
                if (result) {
                    diagnostics = result;
                }
                return ReRes.getDiagnostics();
            })
            .then(function (diag) {
                diagnostics = diag;
                renderTables();
                renderDiagnostics();
            });
    }

    function applyImported(list) {
        if (!Array.isArray(list)) {
            throw new Error('文件内容必须是规则数组');
        }
        maps = list.map(function (rule) {
            return {
                req: typeof rule.req === 'string' ? rule.req : '',
                res: typeof rule.res === 'string' ? rule.res : '',
                group: typeof rule.group === 'string' && rule.group ? rule.group : '未命名',
                checked: rule.checked === true
            };
        });
        return persist();
    }

    document.getElementById('addBtn').addEventListener('click', function () {
        showForm({ req: '', res: '', group: '' }, -1);
    });

    document.getElementById('cancelBtn').addEventListener('click', hideForm);

    formEl.addEventListener('submit', function (event) {
        event.preventDefault();
        var rule = {
            req: reqEl.value.trim(),
            res: resEl.value.trim(),
            group: groupEl.value.trim() || '未命名',
            checked: true
        };
        var error = validate(rule);
        if (error) {
            errEl.textContent = error;
            errEl.hidden = false;
            return;
        }
        if (editingIndex >= 0) {
            rule.checked = maps[editingIndex].checked === true;
            maps[editingIndex] = rule;
        } else {
            maps.push(rule);
        }
        hideForm();
        persist();
    });

    document.getElementById('importBtn').addEventListener('click', function () {
        importFile.click();
    });

    importFile.addEventListener('change', function () {
        var file = importFile.files && importFile.files[0];
        if (!file) {
            return;
        }
        var reader = new FileReader();
        reader.onload = function () {
            try {
                var data = JSON.parse(String(reader.result));
                applyImported(data).then(function () {
                    alert('导入成功，共 ' + maps.length + ' 条规则');
                });
            } catch (e) {
                alert('导入失败：' + e.message);
            }
        };
        reader.readAsText(file);
        importFile.value = '';
    });

    document.getElementById('exportBtn').addEventListener('click', function () {
        var blob = new Blob([JSON.stringify(maps, null, '\t')], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'ReResSetting.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 1000);
    });

    document.getElementById('previewBtn').addEventListener('click', function () {
        var url = previewInput.value.trim();
        if (!url) {
            return;
        }
        var result = ReResEngine.preview(maps, url);
        previewOut.hidden = false;
        if (result.applied < 0) {
            previewOut.textContent = '没有规则命中，请求保持原样 → ' + result.url;
            return;
        }
        var extra = result.hits.length > 1
            ? '（另有 ' + (result.hits.length - 1) + ' 条规则也匹配，但同一个请求只会被一条规则重定向）'
            : '';
        previewOut.textContent = '由第 ' + (result.applied + 1) + ' 条规则重定向 → ' + result.url + extra;
    });

    previewInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            document.getElementById('previewBtn').click();
        }
    });

    ReRes.getMaps().then(function (data) {
        maps = data;
        renderTables();
        return ReRes.getDiagnostics();
    }).then(function (diag) {
        if (diag) {
            diagnostics = diag;
            renderDiagnostics();
            return null;
        }
        // 还没同步过（比如刚装完直接打开这个页面），主动跑一次，
        // 否则诊断面板只会显示「尚未同步」，看不出任何东西。
        return ReRes.sync().then(function (result) {
            diagnostics = result || null;
            renderDiagnostics();
        });
    }).then(function () {
        if (location.hash === '#diagnostics') {
            var panel = document.getElementById('diagnostics');
            if (panel && panel.scrollIntoView) {
                panel.scrollIntoView({ block: 'start' });
            }
        }
    });
})();
