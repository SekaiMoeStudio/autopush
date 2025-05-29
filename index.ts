#!/usr/bin/env bun
import { spawn } from 'child_process';
import { join } from 'path';
import { get } from 'https';
import { URL } from 'url';

type ExecOptions = {
    silent?: boolean;
    env?: Record<string, string>;
    cwd?: string;
};

type ExecResult = {
    code: number;
    stdout: string;
    stderr: string;
};

const getUTCDateTime = (): string => {
    const now = new Date();
    return now.toISOString()
        .replace('T', ' ')
        .replace(/\.\d+Z$/, '');
};

const exec = async (
    command: string, 
    args: string[] = [], 
    options: ExecOptions = {}
): Promise<ExecResult> => {
    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        
        const proc = spawn(command, args, {
            stdio: options.silent ? 'pipe' : 'inherit',
            env: options.env,
            cwd: options.cwd
        });

        if (proc.stdout) {
            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });
        }

        if (proc.stderr) {
            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });
        }

        proc.on('close', (code) => {
            if (code === 0) {
                resolve({ code, stdout, stderr });
            } else {
                reject(new Error(`Command "${command} ${args.join(' ')}" failed with code ${code}\n${stderr}`));
            }
        });

        proc.on('error', (err) => {
            reject(new Error(`Failed to execute command: ${err.message}`));
        });
    });
};

const validateRepoUrl = (url: string): string => {
    if (!url) throw new Error('Repository URL cannot be empty');
    
    url = url.replace(/\.git$/, '');
    
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
    }
    
    try {
        new URL(url);
    } catch (e) {
        throw new Error(`Invalid repository URL: ${url}`);
    }
    
    return url;
};

async function main() {
    console.log(`Current Date and Time (UTC): ${getUTCDateTime()}`);
    console.log(`Current User's Login: ${process.env.GITHUB_ACTOR || 'local'}`);

    try {
        const sourceRepo = process.env.INPUT_SOURCE_REPO || process.env.SOURCE_REPO;
        const targetRepo = process.env.INPUT_TARGET_REPO || process.env.TARGET_REPO;
        const branch = process.env.INPUT_BRANCH || process.env.BRANCH;
        const token = process.env.INPUT_GITHUB_TOKEN || process.env.GITHUB_TOKEN;

        if (!sourceRepo) throw new Error('SOURCE_REPO is required');
        if (!targetRepo) throw new Error('TARGET_REPO is required');
        if (!branch) throw new Error('BRANCH is required');
        if (!token) throw new Error('GITHUB_TOKEN is required');

        const sourceUrl = validateRepoUrl(sourceRepo);
        const targetUrl = `https://github.com/${targetRepo}`;

        console.log(`🚀 Starting mirror process...`);
        console.log(`Source: ${sourceUrl}`);
        console.log(`Target: ${targetUrl}`);
        console.log(`Branch: ${branch}`);

        const { stdout: tempDir } = await exec('mktemp', ['-d'], { silent: true });
        const cleanTempDir = tempDir.trim();
        
        console.log(`📁 Created temporary directory: ${cleanTempDir}`);

        console.log(`📥 Cloning source repository...`);
        await exec('git', [
            'clone',
            '--mirror',
            sourceUrl,
            'source'
        ], { cwd: cleanTempDir });

        console.log(`🔍 Verifying branch: ${branch}`);
        const { stdout: branches } = await exec('git', ['branch', '-a'], { 
            silent: true,
            cwd: join(cleanTempDir, 'source')
        });
        
        const branchExists = branches.includes(branch) || 
                           branches.includes(`remotes/origin/${branch}`);
        
        if (!branchExists) {
            throw new Error(`Branch '${branch}' not found in source repository`);
        }

        console.log(`📤 Pushing to target repository...`);
        await exec('git', [
            'push',
            '--mirror',
            `https://x-access-token:${token}@github.com/${targetRepo}.git`,
            '--force'
        ], { cwd: join(cleanTempDir, 'source') });

        console.log(`✅ Successfully mirrored repository`);
        
        await exec('rm', ['-rf', cleanTempDir]);
        console.log(`🧹 Cleaned up temporary directory`);

    } catch (error) {
        console.error(`❌ Error:`, error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

// 运行主函数
main();
