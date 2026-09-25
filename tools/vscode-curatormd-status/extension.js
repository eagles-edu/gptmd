const vscode = require('vscode');
const path = require('path');
const { execFile } = require('child_process');

const COLORS = {
  green: '#73d216',
  blue: '#4da6ff',
  purple: '#c061cb',
  yellow: '#fce94f',
  cyan: '#34e2e2',
  red: '#ef2929',
  gray: '#888888',
};

function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function check(root, profile) {
  return new Promise((resolve) => {
    const script = path.join(__dirname, 'health-check.py');
    execFile('python3', [script, '--project-root', root, '--profile', profile], {
      cwd: root,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      if (error) {
        resolve({
          state: 'unknown',
          color: 'gray',
          label: 'UNAVAILABLE',
          failures: ['status checker'],
          error: error.message,
        });
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        resolve({
          state: 'unknown',
          color: 'gray',
          label: 'UNAVAILABLE',
          failures: ['status checker'],
          error: parseError.message,
        });
      }
    });
  });
}

function activate(context) {
  const led = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  led.command = 'curatormdStatus.showDetails';
  context.subscriptions.push(led);

  let lastStatus;
  const refresh = async () => {
    const root = workspaceRoot();
    if (!root) {
      led.text = '$(circle-slash) CuratorMD: NO WORKSPACE';
      led.color = COLORS.gray;
      led.tooltip = 'Open the gptmd workspace to inspect CuratorMD.';
      led.show();
      return;
    }
    const profile = vscode.workspace.getConfiguration('curatormdStatus').get('profile', 'gptmd-coding');
    lastStatus = await check(root, profile);
    led.text = `$(circle-filled) CuratorMD: ${lastStatus.label}`;
    led.color = COLORS[lastStatus.color] || COLORS.gray;
    led.tooltip = lastStatus.tooltip || 'Click for CuratorMD status details.';
    led.show();
  };

  const showDetails = () => {
    if (!lastStatus) {
      vscode.window.showInformationMessage('CuratorMD status is still being checked.');
      return;
    }
    const details = [
      `CuratorMD: ${lastStatus.label}`,
      `Hermes: ${lastStatus.hermes ? 'healthy' : 'unhealthy'}`,
      `Codex: ${lastStatus.codex ? 'healthy' : 'unhealthy'}`,
      `CuratorMD: ${lastStatus.curator ? 'healthy' : 'unhealthy'}`,
      `Capture: ${lastStatus.capture || 'unknown'}`,
      `Review notes: ${lastStatus.pendingReview}`,
      lastStatus.working ? 'CuratorMD is currently working.' : 'CuratorMD is idle.',
    ];
    if (lastStatus.failures?.length) details.push(`Failures: ${lastStatus.failures.join(', ')}`);
    vscode.window.showInformationMessage(details.join(' | '));
  };

  context.subscriptions.push(vscode.commands.registerCommand('curatormdStatus.refresh', refresh));
  context.subscriptions.push(vscode.commands.registerCommand('curatormdStatus.showDetails', showDetails));

  const pollSeconds = vscode.workspace.getConfiguration('curatormdStatus').get('pollSeconds', 30);
  const timer = setInterval(refresh, Math.max(5, pollSeconds) * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  refresh();
}

function deactivate() {}

module.exports = { activate, deactivate };
