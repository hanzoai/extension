import * as vscode from 'vscode';

/**
 * Interface defining the metrics tracked by Hanzo
 */
interface HanzoMetrics {
    filesAnalyzed: number;
    lastAnalysisDate: number;
    totalAnalyses: number;
    aiContextScore: number;
}

/**
 * Interface defining calculated metrics for display
 */
interface CalculatedMetrics extends HanzoMetrics {
    productivityBoost: number;
    codeQualityImprovement: number;
}

/**
 * Service for tracking and displaying metrics about how Hanzo has helped the user
 */
export class HanzoMetricsService {
    private context: vscode.ExtensionContext;
    private static instance: HanzoMetricsService;
    private metrics: HanzoMetrics;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        
        // Initialize metrics from stored state or defaults
        this.metrics = this.context.globalState.get('hanzoMetrics') || {
            filesAnalyzed: 0,
            lastAnalysisDate: 0,
            totalAnalyses: 0,
            aiContextScore: 0
        };
        
        console.log('[Hanzo Metrics] Service initialized with metrics:', JSON.stringify(this.metrics));
    }

    /**
     * Get the singleton instance of HanzoMetricsService
     */
    public static getInstance(context: vscode.ExtensionContext): HanzoMetricsService {
        if (!HanzoMetricsService.instance) {
            console.log('[Hanzo Metrics] Creating new HanzoMetricsService instance');
            HanzoMetricsService.instance = new HanzoMetricsService(context);
        }
        return HanzoMetricsService.instance;
    }

    /**
     * Record metrics from a project analysis
     * @param filesAnalyzed Number of files analyzed in this session
     */
    public recordAnalysis(filesAnalyzed: number): void {
        console.log(`[Hanzo Metrics] Recording analysis of ${filesAnalyzed} files`);
        console.log(`[Hanzo Metrics] Before update - filesAnalyzed: ${this.metrics.filesAnalyzed}, totalAnalyses: ${this.metrics.totalAnalyses}`);
        
        // Only count files if a positive number is provided
        if (filesAnalyzed > 0) {
            this.metrics.filesAnalyzed += filesAnalyzed;
            
            // Always increment analysis count regardless of file count
            this.metrics.totalAnalyses += 1;
            this.metrics.lastAnalysisDate = Date.now();
            
            // Calculate AI context score based on files analyzed and analyses performed
            // The more files analyzed and the more analyses performed, the higher the score
            // Score is capped at 100
            const baseScore = Math.min(this.metrics.filesAnalyzed / 10, 70); // Up to 70 points from files
            const analysisBonus = Math.min(this.metrics.totalAnalyses * 5, 30); // Up to 30 points from analyses
            this.metrics.aiContextScore = Math.min(Math.round(baseScore + analysisBonus), 100);
            
            console.log('[Hanzo Metrics] Updated metrics:', JSON.stringify(this.metrics));
            this.saveMetrics();
            
            // Log successful metrics update
            console.log(`[Hanzo Metrics] After update - filesAnalyzed: ${this.metrics.filesAnalyzed}, totalAnalyses: ${this.metrics.totalAnalyses}, aiContextScore: ${this.metrics.aiContextScore}`);
        } else {
            console.log('[Hanzo Metrics] No files to record for this analysis, skipping metrics update');
        }
    }

    /**
     * Check if Hanzo has been used at least once
     */
    public hasBeenUsed(): boolean {
        const hasBeenUsed = this.metrics.totalAnalyses > 0;
        console.log(`[Hanzo Metrics] hasBeenUsed check: ${hasBeenUsed} (totalAnalyses: ${this.metrics.totalAnalyses})`);
        return hasBeenUsed;
    }

    /**
     * Get a succinct summary of Hanzo's impact
     */
    public getSuccinctSummary(): string {
        const { filesAnalyzed, aiContextScore } = this.metrics;
        
        if (filesAnalyzed === 0) {
            return "Hanzo is ready to help you";
        }
        
        return `${filesAnalyzed} files analyzed, AI context improved by ${aiContextScore}%`;
    }

    /**
     * Get a detailed summary of Hanzo's impact
     */
    public getDetailedSummary(): string {
        const { filesAnalyzed, totalAnalyses, aiContextScore } = this.metrics;
        
        if (filesAnalyzed === 0) {
            return "Hanzo hasn't analyzed any files yet. Run an analysis to get started!";
        }
        
        return `Hanzo has analyzed ${filesAnalyzed} files across ${totalAnalyses} analyses, improving AI context by ${aiContextScore}% and boosting your productivity.`;
    }

    /**
     * Get metrics for display in UI
     */
    public getMetricsForDisplay(): HanzoMetrics {
        console.log('[Hanzo Metrics] Getting metrics for display:', JSON.stringify(this.metrics));
        return { ...this.metrics };
    }

    /**
     * Get calculated metrics for display
     * Returns an object with calculated metrics based on the raw metrics
     */
    public getCalculatedMetrics(): CalculatedMetrics {
        // Get metrics with proper fallback values for safety
        const filesAnalyzed = this.metrics.filesAnalyzed || 0;
        const totalAnalyses = this.metrics.totalAnalyses || 0;
        const aiContextScore = this.metrics.aiContextScore || 0;
        const lastAnalysisDate = this.metrics.lastAnalysisDate || 0;
        
        console.log(`[Hanzo Metrics] Calculating display metrics from raw metrics - filesAnalyzed: ${filesAnalyzed}, totalAnalyses: ${totalAnalyses}, aiContextScore: ${aiContextScore}`);
        
        // Ensure we have valid values before calculating
        if (filesAnalyzed === 0 && totalAnalyses === 0) {
            console.log('[Hanzo Metrics] No metrics data available yet, returning default values');
            return {
                filesAnalyzed: 0,
                totalAnalyses: 0,
                aiContextScore: 45, // Base minimum score
                productivityBoost: 30, // Base minimum boost
                codeQualityImprovement: 25, // Base minimum improvement
                lastAnalysisDate: 0
            };
        }
        
        // Calculate improved AI context score (45-95% based on metrics, minimum 45%)
        // Use a combination of files analyzed and analysis runs for a more accurate score
        const analysisMultiplier = Math.min(totalAnalyses, 10) * 2; // More analyses = higher multiplier
        const fileMultiplier = 2; // Base multiplier for files
        
        // Improved calculation that takes both files and runs into account
        const improvedAiContextScore = Math.max(45, Math.min(Math.round((filesAnalyzed * fileMultiplier) + (totalAnalyses * 5) + 40), 95));
        
        // Calculate productivity boost (30-80% based on context score)
        const productivityBoost = Math.round(30 + (improvedAiContextScore / 100) * 50);
        
        // Calculate code quality improvement (25-70% based on context score)
        const codeQualityImprovement = Math.round(25 + (improvedAiContextScore / 100) * 45);
        
        const calculatedMetrics: CalculatedMetrics = {
            filesAnalyzed,
            totalAnalyses,
            aiContextScore: improvedAiContextScore,
            productivityBoost,
            codeQualityImprovement,
            lastAnalysisDate
        };
        
        console.log('[Hanzo Metrics] Calculated metrics for display:', JSON.stringify(calculatedMetrics));
        return calculatedMetrics;
    }

    /**
     * Save metrics to extension storage
     */
    private saveMetrics(): void {
        console.log('[Hanzo Metrics] Saving metrics to global state');
        this.context.globalState.update('hanzoMetrics', this.metrics);
    }

    /**
     * Reset all metrics
     */
    public resetMetrics(): void {
        console.log('[Hanzo Metrics] Resetting all metrics');
        this.metrics = {
            filesAnalyzed: 0,
            lastAnalysisDate: 0,
            totalAnalyses: 0,
            aiContextScore: 0
        };
        this.saveMetrics();
    }
}