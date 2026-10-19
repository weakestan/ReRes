'use strict';
(function () {
    var listEl = document.getElementById('list');
    var statusEl = document.getElementById('status');
    var statusTextEl = document.getElementById('statusText');
    var formEl = document.getElementById('form');
    var errEl = document.getElementById('formError');
    var reqEl = document.getElementById('req');
    var resEl = document.getElementById('res');
    var groupEl = document.getElementById('group');
    var countEl = document.getElementById('count');

    var maps = [];
    var editingIndex = -1;

    function setStatus(text, kind) {
        statusTextEl.textContent = text;
        statusEl.className = 'status' + (kind ? ' ' + kind : '');
        statusEl.title = '点击查看诊断详情';
        statusEl.style.cursor = 'pointer';
    }

    function currentRule() {
        return {
            req: reqEl.value.trim(),
            res: resEl.value.trim(),
            group: groupEl.value.trim() || '未命名',
            checked: true
        };
    }

    function showForm(rule, index) {
        editingIndex = index;
        reqEl.value = rule.req || '';
        resEl.value = rule.res || '';
        groupEl.value = rule.group || '';
        errEl.hidden = true;
        formEl.hidden = false;
        reqEl.focus();
        reqEl.select();
    }

    function hideForm() {
        formEl.hidden = true;
        editingIndex = -1;
        errEl.hidden = true;
    }

    function renderRule(item) {
        var rule = item.rule;
        var row = ReRes.el('div', 'rule' + (rule.checked === true ? '' : ' off'));

        var check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'check';
        check.checked = rule.checked === true;
        check.title = '启用 / 禁用该规则';
        check.addEventListener('change', function () {
            toggleRule(item.index, check.checked);
        });

        var body = ReRes.el('div', 'body');
        var req = ReRes.el('div', 'req', rule.req);
        var res = ReRes.el('div', 'res', '→ ' + rule.res);
        req.title = rule.req;
        res.title = rule.res;
        body.appendChild(req);
        body.appendChild(res);

        var ops = ReRes.el('div', 'ops');

        var editBtn = ReRes.el('button', 'btn btn-light btn-xs', '编辑');
        editBtn.type = 'button';
        editBtn.addEventListener('click', function () {
            showForm(rule, item.index);
        });

        var delBtn = ReRes.el('button', 'btn btn-danger btn-xs', '删除');
        delBtn.type = 'button';
        delBtn.addEventListener('click', function () {
            removeRule(item.index);
        });

        ops.appendChild(editBtn);
        ops.appendChild(delBtn);

        row.appendChild(check);
        row.appendChild(body);
        row.appendChild(ops);
        return row;
    }

    function renderList() {
        listEl.textContent = '';
        if (!maps.length) {
            listEl.appendChild(ReRes.el('div', 'empty', '还没有规则，点击右上角「添加规则」。'));
            return;
        }
        ReRes.groupBy(maps).forEach(function (group) {
            var wrap = ReRes.el('div', 'group');
            wrap.appendChild(ReRes.el('h4', null, group.group));
            group.items.forEach(function (item) {
                wrap.appendChild(renderRule(item));
            });
            listEl.appendChild(wrap);
        });
    }

    function renderCount() {
        var enabled = maps.filter(function (r) { return r && r.checked === true; }).length;
        countEl.textContent = enabled + ' / ' + maps.length + ' 条启用';
    }

    function refreshStatus(diag) {
        if (!diag) {
            setStatus('规则已保存，等待同步…');
            return;
        }
        var applied = typeof diag.applied === 'number' ? diag.applied : 0;
        var errors = diag.errors || [];
        var warns = diag.warnings || [];
        if (errors.length) {
            setStatus('已生效 ' + applied + ' 条，' + errors.length + ' 条未生效（点击查看）', 'error');
        } else if (warns.length) {
            setStatus('已生效 ' + applied + ' 条，' + warns.length + ' 条需注意（点击查看）');
        } else {
            setStatus('已生效 ' + applied + ' 条重定向规则', 'ok');
        }
    }

    function persist() {
        return ReRes.setMaps(maps)
            .then(ReRes.sync)
            .then(function (diag) {
                refreshStatus(diag);
                renderList();
                renderCount();
            });
    }

    function toggleRule(index, checked) {
        maps[index].checked = checked;
        persist();
    }

    function removeRule(index) {
        maps.splice(index, 1);
        persist();
    }

    function validate(rule) {
        if (!rule.req) {
            return 'If URL match 不能为空';
        }
        try {
            new RegExp(rule.req, 'i');
        } catch (e) {
            return '正则语法错误：' + e.message;
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

    document.getElementById('addBtn').addEventListener('click', function () {
        showForm({ req: '', res: '', group: '' }, -1);
    });

    document.getElementById('cancelBtn').addEventListener('click', hideForm);

    formEl.addEventListener('submit', function (event) {
        event.preventDefault();
        var rule = currentRule();
        var error = validate(rule);
        if (error) {
            errEl.textContent = error;
            errEl.hidden = false;
            return;
        }
        if (editingIndex >= 0) {
            rule.checked = maps[editingIndex].checked !== false;
            maps[editingIndex] = rule;
        } else {
            maps.push(rule);
        }
        hideForm();
        persist();
    });

    document.getElementById('optionsLink').addEventListener('click', function (event) {
        event.preventDefault();
        chrome.runtime.openOptionsPage();
        window.close();
    });

    /* 状态行本身就是诊断入口：点击后直接落到「管理规则」页的诊断面板 */
    statusEl.addEventListener('click', function () {
        chrome.tabs.create({ url: chrome.runtime.getURL('options.html#diagnostics') });
        window.close();
    });

    ReRes.getDiagnostics().then(function (diag) {
        refreshStatus(diag);
    });

    ReRes.getMaps().then(function (data) {
        maps = data;
        renderList();
        renderCount();
    });
})();
