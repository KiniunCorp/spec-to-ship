// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	integrations: [
		starlight({
			title: 'Spec-to-Ship',
			favicon: '/favicon.svg',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/KiniunCorp/spec-to-ship' },
			],
			customCss: ['./src/styles/custom.css'],
			components: {
				Header: './src/components/Header.astro',
				Footer: './src/components/Footer.astro',
			},
			defaultLocale: 'en',
			locales: {
				en: { label: 'English' },
				es: { label: 'Español' },
			},
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Introduction', slug: 'introduction' },
						{ label: 'Quick Start', slug: 'quickstart' },
						{ label: 'Manual Setup', slug: 'manual-setup' },
					],
				},
				{
					label: 'Workflow',
					items: [
						{ label: 'Chat-Native Workflow', slug: 'chat-native-workflow' },
						{ label: 'Execution Templates', slug: 'execution-templates' },
						{ label: 'LLM Access Modes', slug: 'llm-access-modes' },
					],
				},
				{
					label: 'Architecture',
					items: [
						{ label: 'Technical Architecture', slug: 'technical-architecture' },
						{ label: 'Architecture Summary', slug: 'tech-architecture-summary' },
						{ label: 'Operations & Security', slug: 'technical-operations-security' },
						{ label: 'Live State Reference', slug: 'live-state' },
					],
				},
				{
					label: 'Operations',
					items: [
						{ label: 'Cost Observability', slug: 'cost-observability' },
						{ label: 'Token Efficiency', slug: 'token-efficiency' },
						{ label: 'Backup & Restore', slug: 'backup-and-restore' },
						{ label: 'Figma MCP Setup', slug: 'figma-mcp-setup' },
					],
				},
				{
					label: 'Distribution',
					items: [
						{ label: 'Homebrew Distribution', slug: 'homebrew-distribution' },
						{ label: 'Versioning & Migrations', slug: 'versioning-and-migrations' },
					],
				},
			],
		}),
	],
	output: 'static',
});
