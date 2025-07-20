/**
 * Example: Using Hanzo AI with Cloud Telemetry
 * 
 * This example shows how to integrate agents and networks with Hanzo Cloud's
 * observability platform for comprehensive monitoring and debugging.
 */

import { createAgent, createNetwork } from '@hanzo/ai';
import { createHanzoCloudTelemetry } from '@hanzo/ai/telemetry/hanzo-cloud';
import { commonTools } from '@hanzo/ai/tools';
import { OpenAIProvider } from '@hanzo/ai/providers/openai';

// Initialize Hanzo Cloud telemetry
const telemetry = createHanzoCloudTelemetry({
  cloudUrl: process.env.HANZO_CLOUD_URL || 'https://cloud.hanzo.ai',
  apiKey: process.env.HANZO_CLOUD_API_KEY!,
  projectId: process.env.HANZO_PROJECT_ID!,
  environment: process.env.NODE_ENV || 'development',
  serviceName: 'customer-support-ai',
  serviceVersion: '1.0.0',
  logLevel: 'info'
});

// Create a session for tracking related executions
const sessionId = telemetry.createSession();
console.log(`Started telemetry session: ${sessionId}`);

// Create agents with telemetry integration
const classifierAgent = createAgent({
  name: 'classifier',
  description: 'Classifies customer inquiries',
  system: `You are a customer inquiry classifier. Analyze the customer's message and classify it into one of these categories:
    - technical_support
    - billing
    - product_info
    - complaint
    - other`,
  tools: [
    commonTools.done(),
    commonTools.handoff()
  ]
});

const techSupportAgent = createAgent({
  name: 'tech_support',
  description: 'Handles technical support issues',
  system: 'You are a technical support specialist. Help customers resolve technical issues with our products.',
  tools: [
    commonTools.done(),
    commonTools.askUser()
  ]
});

const billingAgent = createAgent({
  name: 'billing',
  description: 'Handles billing inquiries',
  system: 'You are a billing specialist. Help customers with payment, subscription, and invoice questions.',
  tools: [
    commonTools.done(),
    commonTools.remember(),
    commonTools.recall()
  ]
});

// Create network with telemetry
const supportNetwork = createNetwork({
  name: 'customer_support',
  agents: [classifierAgent, techSupportAgent, billingAgent],
  defaultModel: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'gpt-4'
  }),
  router: (context) => {
    // First iteration: always start with classifier
    if (context.iteration === 0) {
      return context.network.getAgent('classifier');
    }
    
    // Check if classifier has determined the category
    const category = context.state.get('category');
    const nextAgent = context.state.get('nextAgent');
    
    if (nextAgent) {
      context.state.delete('nextAgent'); // Clear for next iteration
      return context.network.getAgent(nextAgent);
    }
    
    if (category === 'technical_support') {
      return context.network.getAgent('tech_support');
    } else if (category === 'billing') {
      return context.network.getAgent('billing');
    }
    
    return undefined; // No more agents to run
  }
});

// Example: Process customer inquiry with full telemetry
async function handleCustomerInquiry(message: string) {
  // Create a span for the entire operation
  return telemetry.trace(
    'customer_inquiry',
    async (span) => {
      // Add customer context
      span.setAttributes({
        'customer.message.length': message.length,
        'customer.session.id': sessionId
      });
      
      try {
        // Log the inquiry
        telemetry.log('info', 'Processing customer inquiry', {
          messagePreview: message.substring(0, 100)
        });
        
        // Run the support network
        const result = await supportNetwork.run({
          messages: [
            { role: 'user', content: message }
          ],
          telemetry // Pass telemetry instance
        });
        
        // Record success metrics
        telemetry.increment('customer.inquiries.processed', 1, {
          status: 'success',
          category: result.state.category || 'unknown'
        });
        
        // Log the resolution
        telemetry.log('info', 'Customer inquiry resolved', {
          iterations: result.iterations,
          finalAgent: result.history[result.history.length - 1]?.agent,
          category: result.state.category
        });
        
        return result;
      } catch (error) {
        // Record failure metrics
        telemetry.increment('customer.inquiries.processed', 1, {
          status: 'error'
        });
        
        telemetry.log('error', 'Failed to process customer inquiry', {
          error: error instanceof Error ? error.message : String(error)
        });
        
        throw error;
      }
    },
    {
      attributes: {
        'inquiry.type': 'customer_support'
      }
    }
  );
}

// Example: Monitor streaming responses
async function handleStreamingInquiry(message: string) {
  const stream = supportNetwork.stream({
    messages: [
      { role: 'user', content: message }
    ],
    telemetry
  });
  
  let totalTokens = 0;
  
  for await (const chunk of stream) {
    // Track streaming metrics
    if (chunk.type === 'content') {
      totalTokens += chunk.content.length;
      telemetry.gauge('streaming.tokens.current', totalTokens, {
        agent: chunk.agent
      });
    } else if (chunk.type === 'agent:start') {
      telemetry.log('debug', `Agent ${chunk.agent} started at iteration ${chunk.iteration}`);
    } else if (chunk.type === 'agent:complete') {
      telemetry.histogram('agent.streaming.duration', chunk.duration, {
        agent: chunk.agent
      });
    }
    
    // Process chunk...
    console.log(chunk);
  }
}

// Example: Batch processing with telemetry
async function processBatchInquiries(inquiries: string[]) {
  telemetry.log('info', `Starting batch processing of ${inquiries.length} inquiries`);
  
  const results = await Promise.allSettled(
    inquiries.map((inquiry, index) =>
      telemetry.trace(
        `batch_inquiry_${index}`,
        () => handleCustomerInquiry(inquiry),
        {
          attributes: {
            'batch.index': index,
            'batch.total': inquiries.length
          }
        }
      )
    )
  );
  
  // Analyze results
  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  
  telemetry.gauge('batch.success.rate', successful / inquiries.length, {
    batchSize: inquiries.length
  });
  
  telemetry.log('info', 'Batch processing complete', {
    total: inquiries.length,
    successful,
    failed
  });
  
  return results;
}

// Example usage
async function main() {
  try {
    // Single inquiry
    const result = await handleCustomerInquiry(
      "I'm having trouble logging into my account. It says my password is incorrect but I'm sure it's right."
    );
    
    console.log('Result:', result);
    
    // Streaming inquiry
    await handleStreamingInquiry(
      "My last bill seems higher than usual. Can you explain the charges?"
    );
    
    // Batch processing
    const batchResults = await processBatchInquiries([
      "How do I reset my password?",
      "What are your business hours?",
      "I want to cancel my subscription",
      "The app keeps crashing on startup"
    ]);
    
    console.log(`Processed ${batchResults.length} inquiries`);
    
  } finally {
    // Ensure telemetry is flushed before exit
    await telemetry.shutdown();
  }
}

// Run the example
if (require.main === module) {
  main().catch(console.error);
}

// Export for testing
export { handleCustomerInquiry, supportNetwork, telemetry };