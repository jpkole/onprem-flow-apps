Ext.define('Rally.technicalservices.util.Parser', {
    singleton: true,
    /*
     * Read through a text string to find the old and new values
     * for a field that changed
     * 
     * {String} field_name, the name of the field that has a change
     * {String} text_string, the string to test (usually the description of a revision)
     * 
     * returns a hash with three keys: 
     * 
     * description: {String} the text_string that was passed in
     * original_value: {String} the value that the field had before the change happened
     * new_value: {String} the value the field changed into
     */
    findValuesForField: function(field_name, text_string){
        var description = text_string;
        var new_value = null;
        var original_value = null;
        
        // looking for "..., FIELD changed from [old] to [new], ..."
        var regex = new RegExp( Ext.util.Format.uppercase(field_name) + " changed from \\[(.*?)\\] to \\[(.*?)\\]" );
        var matches = this._getMatches(text_string, regex);

        if ( matches.length > 0 ) { original_value = matches[0]; }
        if ( matches.length > 1 ) { new_value = matches[1]; }
        
        if ( original_value === null && new_value === null ) {
            // maybe the format is like
            // FIELD added [new]
            regex = new RegExp( Ext.util.Format.uppercase(field_name) + " added \\[(.*?)\\]" );
            matches = this._getMatches(text_string, regex);
    
            if ( matches.length > 0 ) { 
                new_value = matches[0]; 
                original_value = "";
            }
        }
        
        if ( original_value === null && new_value === null && Ext.util.Format.uppercase(field_name) == 'PROJECTS') {
            // Handle a revision entry on demo-west (Jan-2009): "Added project Project 3"
            regex = new RegExp( "^Added project (.*)$" );
            matches = this._getMatches(text_string, regex);

            if ( matches.length > 0 ) {
                new_value = matches[0];
                original_value = "";
            }
        }
        
        return {
            description: text_string,
            new_value: new_value,
            original_value: original_value
        };
    },
    
    /**
     * given an array of revision objects, find the first revision that changed to the first state and the last
     * revision that changed to the last state
     * 
     * return a two-value array (two revisions) or an empty array (if neither or only one state revision is found)
     */
    findEntryExitRevisions: function(revision_array, field_name, start_state, end_state) {
        var matching_revisions = [];
        var start_revision = null;
        var end_revision = null;
        
        Ext.Array.each( revision_array, function(revision){
            var values = this.findValuesForField(field_name, revision.get('Description'));
            
            if ( !start_revision && values.new_value == start_state ) {
                start_revision = revision;
            }
            
            if ( values.new_value == end_state ) {
                end_revision = revision;
            }
        },this);
        
        if ( end_revision && ! start_revision) {
            // we got to the end without seeing the start.  
            // if the first rev is the original then let's assume it was our start
            if ( revision_array[0].get('Description') == "Original revision" ){
                start_revision = revision_array[0];
            }
        }
        
        if ( start_revision && end_revision ) {
            matching_revisions = [ start_revision, end_revision];
        }
        
        return matching_revisions;
    },
    
    /*
     * Given an array of revisions and a field name that holds the state,
     * find all the state transitions and return an array of objects
     * representing the entry into states for that array.
     */
    getStateAttainments: function(revision_array, field_name) {
        var transitions = [];
        
        var first_date = null;
        var first_value = null;
        
        Ext.Array.each( revision_array, function(revision, index){
            var description = revision.get('Description');
            // find original revision if passed

            var values = this.findValuesForField(field_name, description);
            if ( values.new_value !== null ) {
                transitions.push({ 
                    change_date: revision.get('CreationDate'),
                    state: values.new_value 
                });
                // push original value back to start if we don't have one
                // and if this isn't the first one (starting right into the state)
                if ( values.original_value !== null && first_value === null ) {
                    first_value = values.original_value;
                }
            } else if ( index == 0 ) { 
                first_date = revision.get('CreationDate');
            }
            
        },this);
        
        if ( first_date && first_value ) {
            transitions.unshift({
                change_date: first_date,
                state: first_value 
            });
        }
        
        return transitions;
    },
    /*
     * Provide a hash with a key for each day between first and end; value of
     * each is a hash with keys for each state value that has items -- the value
     * of each of these is an array of the items that are in that state (so we let
     * some other function determine value however it wants)
     * 
     * Input an array of items that have a field called _changes (from getStateAttainments)
     */
    getCumulativeFlow: function(item_array, first_date, end_date){
        var flow = {};
        
        var check_date = first_date;
        
        var preceding_day_values_by_item_id = {};
        
        while (check_date <= end_date ) {
            flow[check_date] = {};
            
            Ext.Array.each(item_array,function(item){
                var preceding_date = Rally.util.DateTime.add(check_date,'day',-1);
                var state = this._getStateBetween(preceding_date,check_date,item);
                if ( state ) {
                    preceding_day_values_by_item_id[item.get('ObjectID')] = state;
                } else if ( preceding_day_values_by_item_id[item.get('ObjectID')]) {
                    var state = preceding_day_values_by_item_id[item.get('ObjectID')];
                }
                                
                if ( state ) {
                    if ( ! flow[check_date][state] ) {
                        flow[check_date][state] = [];
                    }
                    
                    flow[check_date][state].push(item);
                }
            },this);
            
            check_date = Rally.util.DateTime.add(check_date,'day',1);
        }
        
        return flow;
    },
    /*
     * expect an item to have a _changes field (from getStateAttainments)
     * 
     */
    _getStateBetween: function (preceding_date,check_date,item){
        var state = null;
        var changes = item.get('_changes');
        
        Ext.Array.each(changes, function(change){
            var change_date = change.change_date;
            if ( change_date > preceding_date && change_date <= check_date ) {
                state = change.state;
            }
        });
        return state;
    },
    _getMatches: function(string, regex, index) {
        var matches = [];
        var all_matches = regex.exec(string);
        if ( Ext.isArray(all_matches) ) {
            for ( var i=1;i<all_matches.length;i++){
                matches.push(all_matches[i]);
            }
        }
        return matches;
    }
});